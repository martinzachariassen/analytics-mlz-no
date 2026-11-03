package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/store"
)

// Limits on stats queries.
const (
	maxRangeDays      = 5 * 366
	maxHourlyDays     = 7
	maxDailyDays      = 400
	realtimeWindow    = 5 * time.Minute
	maxBreakdownLimit = 1000
)

// period is a parsed date range in a time zone.
type period struct {
	From     string // YYYY-MM-DD, inclusive
	To       string // YYYY-MM-DD, inclusive
	TZ       string
	Interval string // hour | day | month
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
	case "month":
	default:
		return p, errors.New("interval must be hour, day or month")
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

type statsResponse struct {
	Period     periodJSON     `json:"period"`
	Summary    store.Summary  `json:"summary"`
	Previous   store.Summary  `json:"previous"` // same-length period immediately before
	Timeseries []store.Bucket `json:"timeseries"`
}

type periodJSON struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TZ       string `json:"tz"`
	Interval string `json:"interval"`
}

func (a *API) stats(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	p, err := parsePeriod(r.URL.Query(), a.now())
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()

	summary, err := a.Store.Summary(ctx, site.ID, p.rng())
	if err != nil {
		a.internal(w, "summary", err)
		return
	}
	length := p.end.Sub(p.start)
	previous, err := a.Store.Summary(ctx, site.ID, store.Range{From: p.start.Add(-length), To: p.start})
	if err != nil {
		a.internal(w, "previous summary", err)
		return
	}
	series, err := a.Store.Timeseries(ctx, site.ID, p.bounds())
	if err != nil {
		a.internal(w, "timeseries", err)
		return
	}
	for i := range series {
		series[i].Start = series[i].Start.In(p.loc)
	}

	httpx.WriteJSON(w, http.StatusOK, statsResponse{
		Period:     periodJSON{From: p.From, To: p.To, TZ: p.TZ, Interval: p.Interval},
		Summary:    summary,
		Previous:   previous,
		Timeseries: series,
	})
}

func (a *API) breakdown(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	p, err := parsePeriod(q, a.now())
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	dim := q.Get("dim")
	if !slices.Contains(store.Dimensions, dim) {
		httpx.Error(w, http.StatusBadRequest, "unknown dim")
		return
	}
	opt := store.BreakdownOptions{Event: q.Get("event"), PropKey: q.Get("key"), Limit: 10}
	if dim == "prop" && (opt.Event == "" || opt.PropKey == "") {
		httpx.Error(w, http.StatusBadRequest, "dim=prop requires event and key")
		return
	}
	if dim == "prop_key" && opt.Event == "" {
		httpx.Error(w, http.StatusBadRequest, "dim=prop_key requires event")
		return
	}
	if l := q.Get("limit"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 1 || n > maxBreakdownLimit {
			httpx.Error(w, http.StatusBadRequest, fmt.Sprintf("limit must be 1-%d", maxBreakdownLimit))
			return
		}
		opt.Limit = n
	}

	rows, err := a.Store.Breakdown(r.Context(), site.ID, p.rng(), dim, opt)
	if err != nil {
		a.internal(w, "breakdown", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

func (a *API) realtime(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	n, err := a.Store.CurrentVisitors(r.Context(), site.ID, a.now().Add(-realtimeWindow))
	if err != nil {
		a.internal(w, "realtime", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"visitors": n})
}
