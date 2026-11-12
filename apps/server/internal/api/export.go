package api

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// countColumn names what BreakdownRow.Count counts for each dimension. Dimensions that
// count visits have no count column in exports, because the visits column says the same.
var countColumn = map[string]string{
	"path":     "pageviews",
	"hostname": "pageviews",
	"event":    "events",
	"prop":     "events",
	"prop_key": "events",
}

// export writes a breakdown or a time series as CSV, with the same period, filter and
// compare parameters as breakdown and stats. Breakdowns default to 1000 rows and include
// visit metrics where the dimension has them.
func (a *API) export(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	v := r.URL.Query()
	if f := v.Get("format"); f != "" && f != "csv" {
		httpx.Error(w, http.StatusBadRequest, "format must be csv")
		return
	}
	q, ok := a.parseQuery(w, r)
	if !ok {
		return
	}

	var name string
	var records [][]string
	switch v.Get("what") {
	case "breakdown":
		req, err := parseBreakdown(v, q, maxBreakdownLimit)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		req.full = req.dim != "prop" && req.dim != "prop_key"
		rows, ok := a.breakdownRows(w, r, site.ID, q, req)
		if !ok {
			return
		}
		name, records = req.dim, breakdownCSV(req, rows, q.compare != "")
	case "timeseries":
		series, prev, ok := a.timeseries(w, r, site.ID, q)
		if !ok {
			return
		}
		name, records = "timeseries", timeseriesCSV(series, prev)
	default:
		httpx.Error(w, http.StatusBadRequest, "what must be breakdown or timeseries")
		return
	}

	// The domain is a normalised hostname and the dates are YYYY-MM-DD, so the name needs
	// no quoting beyond the surrounding quotes.
	filename := fmt.Sprintf("%s-%s-%s-%s.csv", site.Domain, name, q.From, q.To)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	cw := csv.NewWriter(w)
	_ = cw.WriteAll(records)
}

func breakdownCSV(req breakdownRequest, rows []store.BreakdownRow, compare bool) [][]string {
	label := req.dim
	if req.dim == "prop" {
		label = req.opt.PropKey
	}
	count := countColumn[req.dim]
	header := []string{cell(label), "visitors"}
	if count != "" {
		header = append(header, count)
	}
	if req.full {
		header = append(header, "visits", "bounce_rate", "avg_duration_seconds")
	}
	if compare {
		header = append(header, "previous_visitors")
	}

	out := make([][]string, 0, 1+len(rows))
	out = append(out, header)
	for _, row := range rows {
		rec := []string{cell(row.Value), itoa(row.Visitors)}
		if count != "" {
			rec = append(rec, itoa(row.Count))
		}
		if req.full {
			rec = append(rec, itoa(deref(row.Visits)), ratio(deref(row.BounceRate)), seconds(deref(row.AvgDuration)))
		}
		if compare {
			rec = append(rec, itoa(deref(row.PreviousVisitors)))
		}
		out = append(out, rec)
	}
	return out
}

func timeseriesCSV(series, prev []store.Bucket) [][]string {
	header := []string{"start", "pageviews", "visitors", "visits", "bounce_rate", "avg_duration_seconds"}
	if prev != nil {
		header = append(header, "previous_start", "previous_pageviews", "previous_visitors",
			"previous_visits", "previous_bounce_rate", "previous_avg_duration_seconds")
	}
	out := make([][]string, 0, 1+len(series))
	out = append(out, header)
	for i, b := range series {
		rec := bucketCSV(b)
		if prev != nil {
			rec = append(rec, bucketCSV(prev[i])...)
		}
		out = append(out, rec)
	}
	return out
}

func bucketCSV(b store.Bucket) []string {
	start := ""
	if !b.Start.IsZero() {
		start = b.Start.Format(time.RFC3339)
	}
	return []string{start, itoa(b.Pageviews), itoa(b.Visitors), itoa(b.Visits), ratio(b.BounceRate), seconds(b.AvgDuration)}
}

// cell neutralises spreadsheet formulas: a value starting with =, +, -, @, tab or carriage
// return gets a leading apostrophe, so paths, referrers and event names sent by any
// browser cannot run as formulas when the file is opened (CSV injection).
func cell(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func ratio(f float64) string { return strconv.FormatFloat(f, 'f', 4, 64) }

func seconds(f float64) string { return strconv.FormatFloat(f, 'f', 1, 64) }

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
