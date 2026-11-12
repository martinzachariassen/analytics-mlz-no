package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// newTestAPI serves the API on a real store with a fixed clock. Auth is covered in
// package server; here every route is open.
func newTestAPI(t *testing.T, now time.Time, events []store.Event) (http.Handler, string) {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range events {
		e.SiteID, e.Hostname = site.ID, "mlz.no"
		if e.Type == "" {
			e.Type = "pageview"
		}
		if err := st.InsertEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	a := &API{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return now }}
	a.Register(mux, func(h http.Handler) http.Handler { return h })
	return mux, "/api/sites/" + site.ID
}

func get[T any](t *testing.T, h http.Handler, path string) T {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s = %d %s", path, w.Code, w.Body)
	}
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return v
}

func byValue(rows []store.BreakdownRow) map[string]store.BreakdownRow {
	m := make(map[string]store.BreakdownRow, len(rows))
	for _, r := range rows {
		m[r.Value] = r
	}
	return m
}

func TestHeatmapBucketsInTimeZoneAndHonoursFilters(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// 2026-11-02 is a Monday; Oslo is UTC+1 in November.
	h, base := newTestAPI(t, at("2026-11-05T12:00:00Z"), []store.Event{
		{Time: at("2026-11-02T09:15:00Z"), VisitorID: 1, Path: "/", Country: "NO"},
		{Time: at("2026-11-02T09:16:00Z"), VisitorID: 1, Type: "event", Name: "signup", Path: "/", Country: "NO"},
		{Time: at("2026-11-02T09:45:00Z"), VisitorID: 2, Path: "/a", Country: "NO"},
		{Time: at("2026-11-02T09:50:00Z"), VisitorID: 2, Path: "/b", Country: "NO"},
		{Time: at("2026-11-02T09:20:00Z"), VisitorID: 3, Path: "/", Country: "SE"},
		// A visitor with only a custom event counts as a visitor, not a view.
		{Time: at("2026-11-02T09:30:00Z"), VisitorID: 5, Type: "event", Name: "signup", Path: "/", Country: "NO"},
		// Monday 23:30 UTC is Tuesday 00:30 in Oslo.
		{Time: at("2026-11-02T23:30:00Z"), VisitorID: 1, Path: "/", Country: "NO"},
	})
	q := base + "/heatmap?from=2026-11-02&to=2026-11-03&tz=Europe/Oslo"

	all := get[heatmapResponse](t, h, q)
	if v, pv := all.Visitors[0][10], all.Pageviews[0][10]; v != 4 || pv != 4 {
		t.Fatalf("Mon 10:00 = %d visitors, %d pageviews; want 4, 4 (custom events count as visits, not views)", v, pv)
	}
	if v, pv := all.Visitors[1][0], all.Pageviews[1][0]; v != 1 || pv != 1 {
		t.Fatalf("Tue 00:00 = %d, %d; want the 23:30 UTC view shifted into Tuesday", v, pv)
	}
	if all.Pageviews[0][23] != 0 || all.Pageviews[0][9] != 0 {
		t.Fatal("views landed in UTC hours instead of Oslo hours")
	}

	no := get[heatmapResponse](t, h, q+"&f=country:is:NO")
	if v, pv := no.Visitors[0][10], no.Pageviews[0][10]; v != 3 || pv != 3 {
		t.Fatalf("filtered Mon 10:00 = %d, %d; want 3, 3", v, pv)
	}

	none := get[heatmapResponse](t, h, base+"/heatmap?from=2026-10-01&to=2026-10-02")
	for d := range none.Pageviews {
		for hr, n := range none.Pageviews[d] {
			if n != 0 || none.Visitors[d][hr] != 0 {
				t.Fatalf("empty period has traffic at [%d][%d]", d, hr)
			}
		}
	}
}

func TestRealtime(t *testing.T) {
	now := time.Date(2026, 11, 2, 12, 0, 30, 0, time.UTC)
	ago := func(m int) time.Time { return now.Add(-time.Duration(m) * time.Minute) }
	h, base := newTestAPI(t, now, []store.Event{
		{Time: ago(1), VisitorID: 1, Path: "/", ReferrerHost: "google.com", Country: "NO"},
		{Time: ago(1), VisitorID: 1, Type: "event", Name: "signup", Path: "/", Country: "NO"},
		{Time: ago(2), VisitorID: 2, Path: "/a", Country: "SE"},
		{Time: ago(3), VisitorID: 2, Path: "/a", Country: "SE"},
		// Outside the 5-minute "now" window, inside the 30-minute detail window.
		{Time: ago(10), VisitorID: 3, Path: "/b", Country: "NO"},
		// Outside both.
		{Time: ago(40), VisitorID: 4, Path: "/old", Country: "DK"},
	})

	brief := get[realtimeResponse](t, h, base+"/realtime")
	if brief.Visitors != 2 || brief.Minutes != nil || brief.Pages != nil {
		t.Fatalf("realtime = %+v; want 2 visitors and no detail", brief)
	}

	rt := get[realtimeResponse](t, h, base+"/realtime?detail=1")
	if rt.Visitors != 2 {
		t.Fatalf("visitors = %d, want 2", rt.Visitors)
	}
	if len(rt.Minutes) != realtimeMinutes {
		t.Fatalf("minutes = %d, want %d", len(rt.Minutes), realtimeMinutes)
	}
	first, last := rt.Minutes[0].T, rt.Minutes[len(rt.Minutes)-1].T
	if !first.Equal(time.Date(2026, 11, 2, 11, 31, 0, 0, time.UTC)) || !last.Equal(time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("minutes run %s..%s, want 11:31..12:00 oldest first", first, last)
	}
	var views int64
	for _, m := range rt.Minutes {
		views += m.Pageviews
	}
	if views != 4 {
		t.Fatalf("pageviews in the last 30 minutes = %d, want 4", views)
	}
	if m := rt.Minutes[28]; m.Pageviews != 1 || m.Visitors != 1 {
		t.Fatalf("minute 11:59 = %+v, want visitor 1's view (the custom event is not a view)", m)
	}

	pages := byValue(rt.Pages)
	if len(pages) != 3 || pages["/a"].Count != 2 || pages["/a"].Visitors != 1 || pages["/b"].Visitors != 1 {
		t.Fatalf("pages = %+v", rt.Pages)
	}
	if _, ok := pages["/old"]; ok {
		t.Fatal("a view from 40 minutes ago is in realtime pages")
	}
	if c := byValue(rt.Countries); c["NO"].Visitors != 2 || c["SE"].Visitors != 1 || c["DK"].Visitors != 0 {
		t.Fatalf("countries = %+v", rt.Countries)
	}
	if r := byValue(rt.Referrers); r["google.com"].Visitors != 1 {
		t.Fatalf("referrers = %+v", rt.Referrers)
	}
}

func TestBreakdownFullMetricsWithFilters(t *testing.T) {
	t0 := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	at := func(m int) time.Time { return t0.Add(time.Duration(m) * time.Minute) }
	// Visitor 1: one Chrome visit, 3 pages over 4 minutes. Visitor 2: a Safari bounce on
	// /blog, then a second Safari visit 2 hours later that bounces on /.
	h, base := newTestAPI(t, t0.Add(72*time.Hour), []store.Event{
		{Time: at(0), VisitorID: 1, Path: "/", Browser: "Chrome"},
		{Time: at(2), VisitorID: 1, Path: "/pricing", Browser: "Chrome"},
		{Time: at(4), VisitorID: 1, Path: "/thanks", Browser: "Chrome"},
		{Time: at(5), VisitorID: 2, Path: "/blog", Browser: "Safari"},
		{Time: at(125), VisitorID: 2, Path: "/", Browser: "Safari"},
	})
	q := base + "/breakdown?dim=entry&metrics=full&from=2026-11-02&to=2026-11-02"

	all := byValue(get[[]store.BreakdownRow](t, h, q))
	if r := all["/"]; r.Visits == nil || *r.Visits != 2 || *r.BounceRate != 0.5 || *r.AvgDuration != 120 {
		t.Fatalf("unfiltered entry / = %+v", r)
	}

	safari := byValue(get[[]store.BreakdownRow](t, h, q+"&f=browser:is:Safari"))
	if len(safari) != 2 {
		t.Fatalf("Safari entry rows = %+v, want / and /blog", safari)
	}
	if r := safari["/"]; r.Visitors != 1 || r.Visits == nil || *r.Visits != 1 || *r.BounceRate != 1 || *r.AvgDuration != 0 {
		t.Fatalf("Safari entry / = %+v; the Chrome visit must not count", r)
	}
	if r := safari["/blog"]; r.Visits == nil || *r.Visits != 1 || *r.BounceRate != 1 {
		t.Fatalf("Safari entry /blog = %+v", r)
	}

	// A page filter keeps whole visits that included the page.
	pricing := byValue(get[[]store.BreakdownRow](t, h, q+"&f=path:is:/pricing"))
	if r := pricing["/"]; len(pricing) != 1 || r.Visits == nil || *r.Visits != 1 || *r.BounceRate != 0 || *r.AvgDuration != 240 {
		t.Fatalf("entry rows for visits that saw /pricing = %+v", pricing)
	}
}
