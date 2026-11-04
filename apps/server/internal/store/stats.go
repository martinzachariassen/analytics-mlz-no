package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Range is a half-open time interval [From, To).
type Range struct {
	From, To time.Time
}

// Summary holds aggregate metrics for a range.
type Summary struct {
	Pageviews   int64   `json:"pageviews"`
	Visitors    int64   `json:"visitors"`
	Visits      int64   `json:"visits"`
	BounceRate  float64 `json:"bounce_rate"`  // 0..1, share of visits with at most one page view
	AvgDuration float64 `json:"avg_duration"` // seconds per visit
}

// visitsSQL aggregates visits: one row per session with its page view count
// and duration in milliseconds.
func visitsSQL(where string) string {
	return `SELECT session_id, MIN(ts) AS start, SUM(type = 'pageview') AS pv, MAX(ts) - MIN(ts) AS dur
		FROM events WHERE ` + where + ` GROUP BY session_id`
}

// Summary computes aggregate metrics for a site, narrowed by filters.
func (s *Store) Summary(ctx context.Context, siteID string, r Range, f Filters) (Summary, error) {
	var out Summary
	sc := scope{site: siteID, r: r, filters: f}

	where, args := sc.rows(false)
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(type = 'pageview'), 0), COUNT(DISTINCT visitor_id)
		 FROM events WHERE `+where, args...).Scan(&out.Pageviews, &out.Visitors)
	if err != nil {
		return out, err
	}

	var bounces int64
	var avgMs float64
	where, args = sc.rows(true)
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(SUM(pv <= 1), 0), COALESCE(AVG(dur), 0) FROM (`+visitsSQL(where)+`)`,
		args...).Scan(&out.Visits, &bounces, &avgMs)
	if err != nil {
		return out, err
	}
	if out.Visits > 0 {
		out.BounceRate = float64(bounces) / float64(out.Visits)
	}
	out.AvgDuration = avgMs / 1000
	return out, nil
}

// Bucket is one point in a time series. Visits are counted in the bucket in
// which they started.
type Bucket struct {
	Start       time.Time `json:"t"`
	Pageviews   int64     `json:"pageviews"`
	Visitors    int64     `json:"visitors"`
	Visits      int64     `json:"visits"`
	BounceRate  float64   `json:"bounce_rate"`
	AvgDuration float64   `json:"avg_duration"`
}

// Timeseries returns one bucket per consecutive pair in bounds (len(bounds)-1 buckets).
// Bucket boundaries are computed by the caller so they can follow a time zone, including DST.
func (s *Store) Timeseries(ctx context.Context, siteID string, bounds []time.Time, f Filters) ([]Bucket, error) {
	if len(bounds) < 2 {
		return nil, nil
	}
	n := len(bounds) - 1
	values := make([]string, n)
	args := make([]any, 0, n*3)
	for i := range n {
		values[i] = "(?, ?, ?)"
		args = append(args, i, bounds[i].UnixMilli(), bounds[i+1].UnixMilli())
	}
	sc := scope{site: siteID, r: Range{From: bounds[0], To: bounds[n]}, filters: f}

	out := make([]Bucket, n)
	for i := range out {
		out[i].Start = bounds[i]
	}

	// Page views and visitors: one index range scan per bucket.
	where, wargs := sc.rowsOf("ev", false)
	// #nosec G202 -- only "(?, ?, ?)" placeholders are concatenated.
	rows, err := s.db.QueryContext(ctx,
		`WITH b(i, s, e) AS (VALUES `+strings.Join(values, ", ")+`)
		SELECT b.i, COALESCE(SUM(ev.type = 'pageview'), 0), COUNT(DISTINCT ev.visitor_id)
		FROM b LEFT JOIN events ev ON ev.ts >= b.s AND ev.ts < b.e AND `+where+`
		GROUP BY b.i ORDER BY b.i`,
		append(args, wargs...)...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var i int
		var pv, vis int64
		if err := rows.Scan(&i, &pv, &vis); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out[i].Pageviews, out[i].Visitors = pv, vis
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Visits: one row per visit, placed in the bucket in which it started.
	where, wargs = sc.rows(true)
	// #nosec G202 -- where, col and keep are built from whitelisted columns; values are placeholders.
	rows, err = s.db.QueryContext(ctx, `SELECT start, pv, dur FROM (`+visitsSQL(where)+`)`, wargs...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	bounces := make([]int64, n)
	durMs := make([]float64, n)
	for rows.Next() {
		var start, pv, dur int64
		if err := rows.Scan(&start, &pv, &dur); err != nil {
			return nil, err
		}
		i := sort.Search(n, func(i int) bool { return bounds[i+1].UnixMilli() > start })
		if i == n {
			continue
		}
		out[i].Visits++
		durMs[i] += float64(dur)
		if pv <= 1 {
			bounces[i]++
		}
	}
	for i := range out {
		if v := out[i].Visits; v > 0 {
			out[i].BounceRate = float64(bounces[i]) / float64(v)
			out[i].AvgDuration = durMs[i] / float64(v) / 1000
		}
	}
	return out, rows.Err()
}

// BreakdownRow is one value of a dimension.
type BreakdownRow struct {
	Value    string `json:"value"`
	Visitors int64  `json:"visitors"`
	// Count is page views (path, hostname), visits (sources, entry and exit
	// pages, tech, country) or events (event, prop).
	Count int64 `json:"count"`

	// Set by VisitMetrics (metrics=full): visits that include the value.
	Visits      *int64   `json:"visits,omitempty"`
	BounceRate  *float64 `json:"bounce_rate,omitempty"`
	AvgDuration *float64 `json:"avg_duration,omitempty"`
	// Set by the API when comparing: visitors in the previous period.
	PreviousVisitors *int64 `json:"previous_visitors,omitempty"`
}

// Dimensions supported by Breakdown.
var Dimensions = []string{
	"path", "entry", "exit", "hostname", "referrer", "utm_source", "utm_medium", "utm_campaign",
	"country", "browser", "os", "device", "event", "prop_key", "prop",
}

// BreakdownOptions narrows a breakdown.
type BreakdownOptions struct {
	Event   string // required for "prop" and "prop_key": event name
	PropKey string // required for "prop": property key
	Limit   int
	Filters Filters
	Values  []string // if set, only these values are returned
}

// visitDimCols maps visit-attributed dimensions to their column.
var visitDimCols = map[string]string{
	"entry": "path", "exit": "path", "referrer": "referrer_host",
	"utm_source": "utm_source", "utm_medium": "utm_medium", "utm_campaign": "utm_campaign",
}

// Breakdown returns the top values of a dimension. dim must be one of Dimensions.
func (s *Store) Breakdown(ctx context.Context, siteID string, r Range, dim string, opt BreakdownOptions) ([]BreakdownRow, error) {
	limit := opt.Limit
	if limit <= 0 || limit > 1000 {
		limit = 10
	}
	sc := scope{site: siteID, r: r, filters: opt.Filters}
	pages, pageArgs := sc.rows(false)
	visits, visitArgs := sc.rows(true)

	var query string
	var args []any
	switch dim {
	case "path", "hostname":
		query = `SELECT ` + dim + ` AS value, COUNT(DISTINCT visitor_id), COUNT(*)
			FROM events WHERE ` + pages + ` AND type = 'pageview' GROUP BY 1`
		args = pageArgs

	case "entry", "exit", "referrer", "utm_source", "utm_medium", "utm_campaign":
		// Attribute each visit to its first (or, for exit, last) page view.
		// SQLite returns the other columns from the row holding MIN/MAX(ts)
		// ("bare columns" in aggregates).
		agg := "MIN(ts)"
		if dim == "exit" {
			agg = "MAX(ts)"
		}
		query = `SELECT ` + visitDimCols[dim] + ` AS value, COUNT(DISTINCT visitor_id), COUNT(*) FROM (
			SELECT session_id, visitor_id, path, referrer_host, utm_source, utm_medium, utm_campaign, ` + agg + `
			FROM events WHERE ` + visits + ` AND type = 'pageview' GROUP BY session_id)
			GROUP BY 1`
		args = visitArgs

	case "country", "browser", "os", "device":
		query = `SELECT ` + dim + ` AS value, COUNT(DISTINCT visitor_id), COUNT(DISTINCT session_id)
			FROM events WHERE ` + visits + ` GROUP BY 1`
		args = visitArgs

	case "event":
		query = `SELECT name AS value, COUNT(DISTINCT visitor_id), COUNT(*)
			FROM events WHERE ` + visits + ` AND type = 'event' GROUP BY 1`
		args = visitArgs

	case "prop_key", "prop":
		if opt.Event == "" || (dim == "prop" && opt.PropKey == "") {
			return nil, fmt.Errorf("%s breakdown requires event", dim)
		}
		col, extra := "p.key", ""
		args = append(append([]any{}, visitArgs...), opt.Event)
		if dim == "prop" {
			col, extra = "p.value", " AND p.key = ?"
			args = append(args, opt.PropKey)
		}
		query = `SELECT ` + col + ` AS value, COUNT(DISTINCT e.visitor_id), COUNT(*)
			FROM (SELECT id, visitor_id FROM events WHERE ` + visits + ` AND type = 'event' AND name = ?) e
			JOIN event_props p ON p.event_id = e.id WHERE 1 = 1` + extra + `
			GROUP BY 1`

	default:
		return nil, fmt.Errorf("unknown dimension %q", dim)
	}

	if len(opt.Values) > 0 {
		ph := strings.TrimSuffix(strings.Repeat("?, ", len(opt.Values)), ", ")
		query = `SELECT * FROM (` + query + `) WHERE value IN (` + ph + `)`
		for _, v := range opt.Values {
			args = append(args, v)
		}
	}
	query += ` ORDER BY 2 DESC, 3 DESC, 1 LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []BreakdownRow{}
	for rows.Next() {
		var row BreakdownRow
		if err := rows.Scan(&row.Value, &row.Visitors, &row.Count); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// VisitMetrics adds visit metrics (visits, bounce rate, average duration) to
// breakdown rows. For page dimensions a visit counts when it included the
// page; for event, when the event happened in it. Prop dimensions are left as is.
func (s *Store) VisitMetrics(ctx context.Context, siteID string, r Range, dim string, f Filters, rows []BreakdownRow) error {
	if len(rows) == 0 || dim == "prop" || dim == "prop_key" {
		return nil
	}
	// keep selects the rows that carry the value for a visit.
	var col, keep string
	switch dim {
	case "path", "hostname":
		col, keep = dim, "type = 'pageview'"
	case "entry", "exit", "referrer", "utm_source", "utm_medium", "utm_campaign":
		agg := "MIN"
		if dim == "exit" {
			agg = "MAX"
		}
		col = visitDimCols[dim]
		keep = "type = 'pageview' AND ts = " + agg + "(CASE WHEN type = 'pageview' THEN ts END) OVER w"
	case "country", "browser", "os", "device":
		col, keep = dim, "1"
	case "event":
		col, keep = "name", "type = 'event'"
	default:
		return fmt.Errorf("unknown dimension %q", dim)
	}

	where, args := scope{site: siteID, r: r, filters: f}.rows(true)
	ph := strings.TrimSuffix(strings.Repeat("?, ", len(rows)), ", ")
	for _, row := range rows {
		args = append(args, row.Value)
	}
	// One pass: window functions give every row its visit's page views and
	// duration, then each (visit, value) pair is counted once.
	// #nosec G202 -- where, col and keep are built from whitelisted columns; values are placeholders.
	q, err := s.db.QueryContext(ctx,
		`SELECT value, COUNT(*), COALESCE(SUM(pv <= 1), 0), COALESCE(AVG(dur), 0) FROM (
		   SELECT DISTINCT session_id, value, pv, dur FROM (
		     SELECT session_id, `+col+` AS value, (`+keep+`) AS keep,
		       SUM(type = 'pageview') OVER w AS pv, MAX(ts) OVER w - MIN(ts) OVER w AS dur
		     FROM events WHERE `+where+` WINDOW w AS (PARTITION BY session_id))
		   WHERE keep AND value IN (`+ph+`))
		 GROUP BY 1`, args...)
	if err != nil {
		return err
	}
	defer func() { _ = q.Close() }()

	idx := make(map[string]int, len(rows))
	for i, row := range rows {
		idx[row.Value] = i
		zero, zf, zd := int64(0), 0.0, 0.0
		rows[i].Visits, rows[i].BounceRate, rows[i].AvgDuration = &zero, &zf, &zd
	}
	for q.Next() {
		var value string
		var visits, bounces int64
		var avgMs float64
		if err := q.Scan(&value, &visits, &bounces, &avgMs); err != nil {
			return err
		}
		i, ok := idx[value]
		if !ok {
			continue
		}
		bounce, dur := 0.0, avgMs/1000
		if visits > 0 {
			bounce = float64(bounces) / float64(visits)
		}
		rows[i].Visits, rows[i].BounceRate, rows[i].AvgDuration = &visits, &bounce, &dur
	}
	return q.Err()
}

// Count is visitors and page views in one step of a histogram.
type Count struct {
	Start     time.Time
	Visitors  int64
	Pageviews int64
}

// Histogram counts visitors and page views in fixed steps (for example a
// minute or an hour) from r.From. Steps without traffic are omitted.
// Visitors are distinct per step.
func (s *Store) Histogram(ctx context.Context, siteID string, r Range, f Filters, step time.Duration) ([]Count, error) {
	ms := step.Milliseconds()
	if ms <= 0 {
		return nil, errors.New("step must be positive")
	}
	where, args := scope{site: siteID, r: r, filters: f}.rows(false)
	from := r.From.UnixMilli()
	// #nosec G202 -- where, col and keep are built from whitelisted columns; values are placeholders.
	rows, err := s.db.QueryContext(ctx,
		`SELECT (ts - ?) / ?, COUNT(DISTINCT visitor_id), COALESCE(SUM(type = 'pageview'), 0)
		 FROM events WHERE `+where+` GROUP BY 1 ORDER BY 1`,
		append([]any{from, ms}, args...)...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Count
	for rows.Next() {
		var i int64
		var c Count
		if err := rows.Scan(&i, &c.Visitors, &c.Pageviews); err != nil {
			return nil, err
		}
		c.Start = time.UnixMilli(from + i*ms)
		out = append(out, c)
	}
	return out, rows.Err()
}

// CurrentVisitors counts distinct visitors with activity since t.
func (s *Store) CurrentVisitors(ctx context.Context, siteID string, since time.Time) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT visitor_id) FROM events WHERE site_id = ? AND ts >= ?`,
		siteID, since.UnixMilli()).Scan(&n)
	return n, err
}
