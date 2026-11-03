package store

import (
	"context"
	"fmt"
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

// Summary computes aggregate metrics for a site.
func (s *Store) Summary(ctx context.Context, siteID string, r Range) (Summary, error) {
	var out Summary
	from, to := r.From.UnixMilli(), r.To.UnixMilli()

	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(type = 'pageview'), 0), COUNT(DISTINCT visitor_id)
		 FROM events WHERE site_id = ? AND ts >= ? AND ts < ?`,
		siteID, from, to).Scan(&out.Pageviews, &out.Visitors)
	if err != nil {
		return out, err
	}

	var bounces int64
	var avgMs float64
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(SUM(pv <= 1), 0), COALESCE(AVG(dur), 0) FROM (
		   SELECT SUM(type = 'pageview') AS pv, MAX(ts) - MIN(ts) AS dur
		   FROM events WHERE site_id = ? AND ts >= ? AND ts < ?
		   GROUP BY session_id)`,
		siteID, from, to).Scan(&out.Visits, &bounces, &avgMs)
	if err != nil {
		return out, err
	}
	if out.Visits > 0 {
		out.BounceRate = float64(bounces) / float64(out.Visits)
	}
	out.AvgDuration = avgMs / 1000
	return out, nil
}

// Bucket is one point in a time series.
type Bucket struct {
	Start     time.Time `json:"t"`
	Pageviews int64     `json:"pageviews"`
	Visitors  int64     `json:"visitors"`
}

// Timeseries returns one bucket per consecutive pair in bounds (len(bounds)-1 buckets).
// Bucket boundaries are computed by the caller so they can follow a time zone, including DST.
func (s *Store) Timeseries(ctx context.Context, siteID string, bounds []time.Time) ([]Bucket, error) {
	if len(bounds) < 2 {
		return nil, nil
	}
	n := len(bounds) - 1
	values := make([]string, n)
	args := make([]any, 0, n*3+1)
	for i := range n {
		values[i] = "(?, ?, ?)"
		args = append(args, i, bounds[i].UnixMilli(), bounds[i+1].UnixMilli())
	}
	args = append(args, siteID)

	// #nosec G202 -- only "(?, ?, ?)" placeholders are concatenated.
	query := `WITH b(i, s, e) AS (VALUES ` + strings.Join(values, ", ") + `)
		SELECT b.i, COALESCE(SUM(ev.type = 'pageview'), 0), COUNT(DISTINCT ev.visitor_id)
		FROM b LEFT JOIN events ev ON ev.site_id = ? AND ev.ts >= b.s AND ev.ts < b.e
		GROUP BY b.i ORDER BY b.i`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make([]Bucket, n)
	for i := range out {
		out[i].Start = bounds[i]
	}
	for rows.Next() {
		var i int
		var pv, vis int64
		if err := rows.Scan(&i, &pv, &vis); err != nil {
			return nil, err
		}
		out[i].Pageviews, out[i].Visitors = pv, vis
	}
	return out, rows.Err()
}

// BreakdownRow is one value of a dimension.
type BreakdownRow struct {
	Value    string `json:"value"`
	Visitors int64  `json:"visitors"`
	// Count is page views (path), visits (sources, entry pages, tech, country) or events (event, prop).
	Count int64 `json:"count"`
}

// Dimensions supported by Breakdown.
var Dimensions = []string{
	"path", "entry", "hostname", "referrer", "utm_source", "utm_medium", "utm_campaign",
	"country", "browser", "os", "device", "event", "prop",
}

// BreakdownOptions narrows a breakdown.
type BreakdownOptions struct {
	Event   string // required for "prop": event name
	PropKey string // required for "prop": property key
	Limit   int
}

// Breakdown returns the top values of a dimension. dim must be one of Dimensions.
func (s *Store) Breakdown(ctx context.Context, siteID string, r Range, dim string, opt BreakdownOptions) ([]BreakdownRow, error) {
	limit := opt.Limit
	if limit <= 0 || limit > 1000 {
		limit = 10
	}
	base := []any{siteID, r.From.UnixMilli(), r.To.UnixMilli()}
	const inRange = `site_id = ? AND ts >= ? AND ts < ?`

	var query string
	args := base
	switch dim {
	case "path", "hostname":
		query = `SELECT ` + dim + `, COUNT(DISTINCT visitor_id), COUNT(*)
			FROM events WHERE ` + inRange + ` AND type = 'pageview' GROUP BY 1`

	case "entry", "referrer", "utm_source", "utm_medium", "utm_campaign":
		// Attribute each visit to its first page view. SQLite returns the other
		// columns from the row holding MIN(ts) ("bare columns" in aggregates).
		col := map[string]string{"entry": "path", "referrer": "referrer_host"}[dim]
		if col == "" {
			col = dim
		}
		query = `SELECT ` + col + `, COUNT(DISTINCT visitor_id), COUNT(*) FROM (
			SELECT session_id, visitor_id, path, referrer_host, utm_source, utm_medium, utm_campaign, MIN(ts)
			FROM events WHERE ` + inRange + ` AND type = 'pageview' GROUP BY session_id)
			GROUP BY 1`

	case "country", "browser", "os", "device":
		query = `SELECT ` + dim + `, COUNT(DISTINCT visitor_id), COUNT(DISTINCT session_id)
			FROM events WHERE ` + inRange + ` GROUP BY 1`

	case "event":
		query = `SELECT name, COUNT(DISTINCT visitor_id), COUNT(*)
			FROM events WHERE ` + inRange + ` AND type = 'event' GROUP BY 1`

	case "prop":
		if opt.Event == "" || opt.PropKey == "" {
			return nil, fmt.Errorf("prop breakdown requires event and key")
		}
		query = `SELECT p.value, COUNT(DISTINCT e.visitor_id), COUNT(*)
			FROM events e JOIN event_props p ON p.event_id = e.id
			WHERE e.site_id = ? AND e.ts >= ? AND e.ts < ? AND e.type = 'event'
			  AND e.name = ? AND p.key = ?
			GROUP BY 1`
		args = append(args, opt.Event, opt.PropKey)

	default:
		return nil, fmt.Errorf("unknown dimension %q", dim)
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

// CurrentVisitors counts distinct visitors with activity since t.
func (s *Store) CurrentVisitors(ctx context.Context, siteID string, since time.Time) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT visitor_id) FROM events WHERE site_id = ? AND ts >= ?`,
		siteID, since.UnixMilli()).Scan(&n)
	return n, err
}
