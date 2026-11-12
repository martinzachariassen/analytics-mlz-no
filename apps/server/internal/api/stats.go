package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// Limits on stats queries.
const (
	maxRangeDays      = 5 * 366
	maxHourlyDays     = 7
	maxDailyDays      = 400
	realtimeWindow    = 5 * time.Minute
	maxBreakdownLimit = 1000
	maxFilters        = 10
	realtimeMinutes   = 30
)

// period is a parsed date range in a time zone.
type period struct {
	From     string // YYYY-MM-DD, inclusive
	To       string // YYYY-MM-DD, inclusive
	TZ       string
	Interval string // hour | day | week | month
	loc      *time.Location
	start    time.Time
	end      time.Time // exclusive: midnight after To
}

func (p period) rng() store.Range { return store.Range{From: p.start, To: p.end} }

// parsePeriod reads from, to, tz and interval query parameters.
// Defaults: tz=UTC, to=from, from=today; interval chosen from the range length.
func parsePeriod(q url.Values, now time.Time) (period, error) {
	p := period{TZ: q.Get("tz"), From: q.Get("from"), To: q.Get("to"), Interval: q.Get("interval")}
	if p.TZ == "" {
		p.TZ = "UTC"
	}
	loc, err := time.LoadLocation(p.TZ)
	if err != nil {
		return p, fmt.Errorf("unknown time zone %q", p.TZ)
	}
	p.loc = loc

	if p.From == "" {
		p.From = now.In(loc).Format(time.DateOnly)
	}
	if p.To == "" {
		p.To = p.From
	}
	from, err := time.ParseInLocation(time.DateOnly, p.From, loc)
	if err != nil {
		return p, errors.New("from must be YYYY-MM-DD")
	}
	to, err := time.ParseInLocation(time.DateOnly, p.To, loc)
	if err != nil {
		return p, errors.New("to must be YYYY-MM-DD")
	}
	if to.Before(from) {
		return p, errors.New("to must not be before from")
	}
	p.start = from
	p.end = time.Date(to.Year(), to.Month(), to.Day()+1, 0, 0, 0, 0, loc)

	days := int(p.end.Sub(p.start).Hours()/24 + 0.5)
	if days > maxRangeDays {
		return p, fmt.Errorf("range must be at most %d days", maxRangeDays)
	}
	switch p.Interval {
	case "":
		switch {
		case days <= 2:
			p.Interval = "hour"
		case days <= 93:
			p.Interval = "day"
		default:
			p.Interval = "month"
		}
	case "hour":
		if days > maxHourlyDays {
			return p, fmt.Errorf("hourly interval supports at most %d days", maxHourlyDays)
		}
	case "day":
		if days > maxDailyDays {
			return p, fmt.Errorf("daily interval supports at most %d days", maxDailyDays)
		}
	case "week", "month":
	default:
		return p, errors.New("interval must be hour, day, week or month")
	}
	return p, nil
}

// bounds returns bucket boundaries from start to end in the period's time zone.
// Daily and monthly buckets follow local midnight, so DST days are 23 or 25 hours.
func (p period) bounds() []time.Time {
	out := []time.Time{p.start}
	t := p.start
	for t.Before(p.end) {
		switch p.Interval {
		case "hour":
			t = t.Add(time.Hour)
		case "day":
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, p.loc)
		case "week":
			// Weeks start on Monday; the first bucket may be shorter.
			t = time.Date(t.Year(), t.Month(), t.Day()+daysToMonday(t.Weekday()), 0, 0, 0, 0, p.loc)
		default: // month
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, p.loc)
		}
		if t.After(p.end) {
			t = p.end
		}
		out = append(out, t)
	}
	return out
}

// daysToMonday is the number of days from a weekday to the next Monday.
func daysToMonday(d time.Weekday) int {
	return (int(time.Monday)-int(d)+6)%7 + 1
}

// comparison returns the period to compare p with: "previous" is the
// same-length period immediately before (whole calendar months shift by
// months, so last month compares with the month before), "year" is the same
// dates a year earlier.
func (p period) comparison(mode string) period {
	c := p
	switch {
	case mode == "year":
		c.start, c.end = p.start.AddDate(-1, 0, 0), p.end.AddDate(-1, 0, 0)
	case p.start.Day() == 1 && p.end.Day() == 1:
		months := (p.end.Year()-p.start.Year())*12 + int(p.end.Month()-p.start.Month())
		c.start, c.end = p.start.AddDate(0, -months, 0), p.start
	default:
		days := int(p.end.Sub(p.start).Hours()/24 + 0.5)
		c.start, c.end = p.start.AddDate(0, 0, -days), p.start
	}
	c.From = c.start.Format(time.DateOnly)
	c.To = c.end.AddDate(0, 0, -1).Format(time.DateOnly)
	return c
}

// parseCompare reads the compare parameter: "", "previous" or "year".
func parseCompare(q url.Values) (string, error) {
	switch c := q.Get("compare"); c {
	case "", "previous", "year":
		return c, nil
	default:
		return "", errors.New("compare must be previous or year")
	}
}

// parseFilters reads repeated f=dim:op:value parameters.
func parseFilters(q url.Values) (store.Filters, error) {
	var fs store.Filters
	for _, raw := range q["f"] {
		dim, rest, ok1 := strings.Cut(raw, ":")
		op, value, ok2 := strings.Cut(rest, ":")
		if !ok1 || !ok2 {
			return nil, fmt.Errorf("filter %q must be dim:op:value", raw)
		}
		fs = append(fs, store.Filter{Dim: dim, Op: op, Value: value})
	}
	if len(fs) > maxFilters {
		return nil, fmt.Errorf("at most %d filters", maxFilters)
	}
	return fs, fs.Validate()
}

// query is the common part of a stats request.
type query struct {
	period
	filters store.Filters
	compare string
}

func (a *API) parseQuery(w http.ResponseWriter, r *http.Request) (query, bool) {
	q := r.URL.Query()
	p, err := parsePeriod(q, a.now())
	if err == nil {
		var out query
		out.period = p
		if out.filters, err = parseFilters(q); err == nil {
			if out.compare, err = parseCompare(q); err == nil {
				return out, true
			}
		}
	}
	httpx.Error(w, http.StatusBadRequest, err.Error())
	return query{}, false
}

type statsResponse struct {
	Period     periodJSON     `json:"period"`
	Summary    store.Summary  `json:"summary"`
	Previous   store.Summary  `json:"previous"` // the comparison period (default: the one immediately before)
	Timeseries []store.Bucket `json:"timeseries"`
	// Set when compare is given: the comparison period's buckets, aligned by
	// index with timeseries (cut or padded to the same length).
	PreviousTimeseries []store.Bucket `json:"previous_timeseries,omitempty"`
	Compare            *periodJSON    `json:"compare,omitempty"`
}

type periodJSON struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TZ       string `json:"tz"`
	Interval string `json:"interval"`
}

func (p period) json() periodJSON {
	return periodJSON{From: p.From, To: p.To, TZ: p.TZ, Interval: p.Interval}
}

func (a *API) stats(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	q, ok := a.parseQuery(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	cmp := q.comparison(q.compare)

	summary, err := a.Store.Summary(ctx, site.ID, q.rng(), q.filters)
	if err != nil {
		a.internal(w, "summary", err)
		return
	}
	previous, err := a.Store.Summary(ctx, site.ID, cmp.rng(), q.filters)
	if err != nil {
		a.internal(w, "previous summary", err)
		return
	}
	series, prevSeries, ok := a.timeseries(w, r, site.ID, q)
	if !ok {
		return
	}
	resp := statsResponse{Period: q.json(), Summary: summary, Previous: previous, Timeseries: series}
	if q.compare != "" {
		pj := cmp.json()
		resp.PreviousTimeseries, resp.Compare = prevSeries, &pj
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (a *API) breakdown(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	q, ok := a.parseQuery(w, r)
	if !ok {
		return
	}
	req, err := parseBreakdown(r.URL.Query(), q, 10)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if m := r.URL.Query().Get("metrics"); m != "" && m != "full" {
		httpx.Error(w, http.StatusBadRequest, "metrics must be full")
		return
	}
	req.full = r.URL.Query().Get("metrics") == "full"
	rows, ok := a.breakdownRows(w, r, site.ID, q, req)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// breakdownRequest is a parsed breakdown: the dimension, its options and whether to add
// visit metrics.
type breakdownRequest struct {
	dim  string
	opt  store.BreakdownOptions
	full bool
}

// parseBreakdown reads dim, event, key and limit (default limit when absent).
func parseBreakdown(v url.Values, q query, limit int) (breakdownRequest, error) {
	req := breakdownRequest{
		dim: v.Get("dim"),
		opt: store.BreakdownOptions{Event: v.Get("event"), PropKey: v.Get("key"), Limit: limit, Filters: q.filters},
	}
	switch {
	case !slices.Contains(store.Dimensions, req.dim):
		return req, errors.New("unknown dim")
	case req.dim == "prop" && (req.opt.Event == "" || req.opt.PropKey == ""):
		return req, errors.New("dim=prop requires event and key")
	case req.dim == "prop_key" && req.opt.Event == "":
		return req, errors.New("dim=prop_key requires event")
	}
	if l := v.Get("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 1 || n > maxBreakdownLimit {
			return req, fmt.Errorf("limit must be 1-%d", maxBreakdownLimit)
		}
		req.opt.Limit = n
	}
	return req, nil
}

// breakdownRows runs a breakdown with its visit metrics and comparison. On failure it has
// written the response and returns false.
func (a *API) breakdownRows(w http.ResponseWriter, r *http.Request, siteID string, q query, req breakdownRequest) ([]store.BreakdownRow, bool) {
	ctx := r.Context()
	rows, err := a.Store.Breakdown(ctx, siteID, q.rng(), req.dim, req.opt)
	if err != nil {
		a.internal(w, "breakdown", err)
		return nil, false
	}
	if req.full {
		if err := a.Store.VisitMetrics(ctx, siteID, q.rng(), req.dim, q.filters, rows); err != nil {
			a.internal(w, "visit metrics", err)
			return nil, false
		}
	}
	if q.compare != "" && len(rows) > 0 {
		popt := req.opt
		popt.Limit = len(rows)
		for _, row := range rows {
			popt.Values = append(popt.Values, row.Value)
		}
		prev, err := a.Store.Breakdown(ctx, siteID, q.comparison(q.compare).rng(), req.dim, popt)
		if err != nil {
			a.internal(w, "previous breakdown", err)
			return nil, false
		}
		byValue := make(map[string]int64, len(prev))
		for _, p := range prev {
			byValue[p.Value] = p.Visitors
		}
		for i := range rows {
			n := byValue[rows[i].Value]
			rows[i].PreviousVisitors = &n
		}
	}
	return rows, true
}

// timeseries returns the period's buckets in its time zone and, when comparing, the
// comparison period's buckets aligned by index (cut or padded to the same length). On
// failure it has written the response and returns false.
func (a *API) timeseries(w http.ResponseWriter, r *http.Request, siteID string, q query) (series, prev []store.Bucket, ok bool) {
	ctx := r.Context()
	series, err := a.Store.Timeseries(ctx, siteID, q.bounds(), q.filters)
	if err != nil {
		a.internal(w, "timeseries", err)
		return nil, nil, false
	}
	for i := range series {
		series[i].Start = series[i].Start.In(q.loc)
	}
	if q.compare == "" {
		return series, nil, true
	}
	raw, err := a.Store.Timeseries(ctx, siteID, q.comparison(q.compare).bounds(), q.filters)
	if err != nil {
		a.internal(w, "previous timeseries", err)
		return nil, nil, false
	}
	prev = make([]store.Bucket, len(series))
	for i := range prev {
		if i < len(raw) {
			prev[i] = raw[i]
			prev[i].Start = raw[i].Start.In(q.loc)
		}
	}
	return series, prev, true
}

type heatmapResponse struct {
	// Visitors and Pageviews are indexed [weekday][hour], Monday first, in
	// the period's time zone. Visitors are distinct per hour, summed.
	Visitors  [7][24]int64 `json:"visitors"`
	Pageviews [7][24]int64 `json:"pageviews"`
}

func (a *API) heatmap(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	q, ok := a.parseQuery(w, r)
	if !ok {
		return
	}
	counts, err := a.Store.Histogram(r.Context(), site.ID, q.rng(), q.filters, time.Hour)
	if err != nil {
		a.internal(w, "heatmap", err)
		return
	}
	var out heatmapResponse
	for _, c := range counts {
		t := c.Start.In(q.loc)
		d := (int(t.Weekday()) + 6) % 7
		out.Visitors[d][t.Hour()] += c.Visitors
		out.Pageviews[d][t.Hour()] += c.Pageviews
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

type realtimeResponse struct {
	Visitors int64 `json:"visitors"` // last 5 minutes
	// One entry per minute for the last 30 minutes, oldest first.
	Minutes   []minuteJSON         `json:"minutes"`
	Pages     []store.BreakdownRow `json:"pages"`
	Referrers []store.BreakdownRow `json:"referrers"`
	Countries []store.BreakdownRow `json:"countries"`
}

type minuteJSON struct {
	T         time.Time `json:"t"`
	Visitors  int64     `json:"visitors"`
	Pageviews int64     `json:"pageviews"`
}

func (a *API) realtime(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	now := a.now()
	n, err := a.Store.CurrentVisitors(ctx, site.ID, now.Add(-realtimeWindow))
	if err != nil {
		a.internal(w, "realtime", err)
		return
	}
	out := realtimeResponse{Visitors: n}
	if r.URL.Query().Get("detail") == "" {
		httpx.WriteJSON(w, http.StatusOK, out)
		return
	}

	end := now.Truncate(time.Minute).Add(time.Minute)
	rng := store.Range{From: end.Add(-realtimeMinutes * time.Minute), To: end}
	counts, err := a.Store.Histogram(ctx, site.ID, rng, nil, time.Minute)
	if err != nil {
		a.internal(w, "realtime minutes", err)
		return
	}
	out.Minutes = make([]minuteJSON, realtimeMinutes)
	for i := range out.Minutes {
		out.Minutes[i].T = rng.From.Add(time.Duration(i) * time.Minute).UTC()
	}
	for _, c := range counts {
		i := int(c.Start.Sub(rng.From) / time.Minute)
		if i >= 0 && i < realtimeMinutes {
			out.Minutes[i].Visitors, out.Minutes[i].Pageviews = c.Visitors, c.Pageviews
		}
	}
	for dim, dst := range map[string]*[]store.BreakdownRow{"path": &out.Pages, "referrer": &out.Referrers, "country": &out.Countries} {
		rows, err := a.Store.Breakdown(ctx, site.ID, rng, dim, store.BreakdownOptions{Limit: 10})
		if err != nil {
			a.internal(w, "realtime "+dim, err)
			return
		}
		*dst = rows
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
