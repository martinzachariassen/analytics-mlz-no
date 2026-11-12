package api

import (
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func exportCSV(t *testing.T, h http.Handler, path string) ([][]string, http.Header) {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s = %d %s", path, w.Code, w.Body)
	}
	recs, err := csv.NewReader(w.Body).ReadAll()
	if err != nil {
		t.Fatalf("GET %s: invalid CSV: %v", path, err)
	}
	return recs, w.Header()
}

func TestExportBreakdown(t *testing.T) {
	at := func(d, m int) time.Time { return time.Date(2026, 11, d, 10, m, 0, 0, time.UTC) }
	h, base := newTestAPI(t, at(3, 0), []store.Event{
		{Time: at(2, 0), VisitorID: 1, Path: "/", Country: "NO"},
		{Time: at(2, 1), VisitorID: 1, Path: "/=HYPERLINK(\"http://evil\")", Country: "NO"},
		{Time: at(2, 0), VisitorID: 2, Path: "/", Country: "SE"},
		{Time: at(2, 1), VisitorID: 2, Type: "event", Name: "@sum", Path: "/", Country: "SE"},
		{Time: at(1, 0), VisitorID: 3, Path: "/", Country: "NO"},
	})

	recs, hdr := exportCSV(t, h, base+"/export?what=breakdown&dim=path&from=2026-11-02&compare=previous")
	if ct := hdr.Get("Content-Type"); ct != "text/csv; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := hdr.Get("Content-Disposition"); cd != `attachment; filename="mlz.no-path-2026-11-02-2026-11-02.csv"` {
		t.Errorf("Content-Disposition = %q", cd)
	}
	want := [][]string{
		{"path", "visitors", "pageviews", "visits", "bounce_rate", "avg_duration_seconds", "previous_visitors"},
		{"/", "2", "2", "2", "0.5000", "60.0", "1"},
		{"/=HYPERLINK(\"http://evil\")", "1", "1", "1", "0.0000", "60.0", "0"},
	}
	if got := strings.Join(flatten(recs), "|"); got != strings.Join(flatten(want), "|") {
		t.Errorf("path export:\n got %q\nwant %q", recs, want)
	}

	// Values that a spreadsheet would run as a formula get a leading apostrophe.
	recs, _ = exportCSV(t, h, base+"/export?what=breakdown&dim=event&from=2026-11-02")
	if len(recs) != 2 || recs[1][0] != "'@sum" || recs[0][2] != "events" {
		t.Errorf("event export = %q; want the name escaped and an events column", recs)
	}
	// Visit dimensions have no separate count column: it would repeat visits.
	recs, _ = exportCSV(t, h, base+"/export?what=breakdown&dim=country&from=2026-11-02&f=country:is:SE")
	if strings.Join(recs[0], ",") != "country,visitors,visits,bounce_rate,avg_duration_seconds" || len(recs) != 2 || recs[1][0] != "SE" {
		t.Errorf("filtered country export = %q", recs)
	}
}

func TestExportTimeseries(t *testing.T) {
	at := func(d, hh int) time.Time { return time.Date(2026, 11, d, hh, 0, 0, 0, time.UTC) }
	h, base := newTestAPI(t, at(4, 0), []store.Event{
		{Time: at(2, 10), VisitorID: 1, Path: "/"},
		{Time: at(3, 10), VisitorID: 2, Path: "/"},
		{Time: at(3, 11), VisitorID: 3, Path: "/"},
		{Time: at(1, 10), VisitorID: 4, Path: "/"},
	})
	recs, hdr := exportCSV(t, h, base+"/export?what=timeseries&from=2026-11-02&to=2026-11-03&interval=day&tz=Europe/Oslo&compare=previous")
	if !strings.Contains(hdr.Get("Content-Disposition"), "mlz.no-timeseries-2026-11-02-2026-11-03.csv") {
		t.Errorf("Content-Disposition = %q", hdr.Get("Content-Disposition"))
	}
	if len(recs) != 3 || len(recs[0]) != 12 || recs[0][0] != "start" || recs[0][6] != "previous_start" {
		t.Fatalf("timeseries export = %q", recs)
	}
	if recs[1][0] != "2026-11-02T00:00:00+01:00" || recs[1][2] != "1" || recs[2][2] != "2" {
		t.Errorf("current buckets = %q", recs[1:])
	}
	// 2 November compares with 31 October, 3 November with 1 November.
	if recs[1][6] != "2026-10-31T00:00:00+01:00" || recs[1][8] != "0" || recs[2][8] != "1" {
		t.Errorf("previous buckets = %q", recs[1:])
	}
}

func TestExportRejectsBadParameters(t *testing.T) {
	h, base := newTestAPI(t, time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC), nil)
	for _, q := range []string{
		"what=breakdown",                  // no dim
		"what=breakdown&dim=nope",         // unknown dim
		"what=breakdown&dim=prop&event=x", // prop needs key
		"what=breakdown&dim=path&limit=1001",
		"what=heatmap",
		"",
		"what=timeseries&format=xlsx",
		"what=timeseries&f=bad",
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, base+"/export?"+q, nil))
		if w.Code != http.StatusBadRequest {
			t.Errorf("export?%s = %d; want 400", q, w.Code)
		}
	}
}

func TestCellEscapesFormulas(t *testing.T) {
	for in, want := range map[string]string{
		"=1+1": "'=1+1", "+1": "'+1", "-1": "'-1", "@A1": "'@A1", "\tx": "'\tx", "\rx": "'\rx",
		"/blog": "/blog", "": "", "a=b": "a=b",
	} {
		if got := cell(in); got != want {
			t.Errorf("cell(%q) = %q; want %q", in, got, want)
		}
	}
}

func flatten(recs [][]string) []string {
	var out []string
	for _, r := range recs {
		out = append(out, strings.Join(r, ","))
	}
	return out
}
