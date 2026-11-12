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
		{Time: ago(5).Add(-time.Millisecond), VisitorID: 3, Path: "/b", Country: "NO"},
		// The first instant of the detail window (11:31:00) is in, the one before it is out.
		{Time: time.Date(2026, 11, 2, 11, 31, 0, 0, time.UTC), VisitorID: 3, Path: "/b", Country: "NO"},
		{Time: time.Date(2026, 11, 2, 11, 30, 59, 999e6, time.UTC), VisitorID: 4, Path: "/old", Country: "DK"},
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
	if views != 6 {
		t.Fatalf("pageviews in the last 30 minutes = %d, want 6", views)
	}
	if m := rt.Minutes[0]; m.Pageviews != 1 {
		t.Fatalf("minute 11:31 = %+v, want the view at the window start", m)
	}
	if m := rt.Minutes[28]; m.Pageviews != 1 || m.Visitors != 1 {
		t.Fatalf("minute 11:59 = %+v, want visitor 1's view (the custom event is not a view)", m)
	}

	pages := byValue(rt.Pages)
	if len(pages) != 3 || pages["/a"].Count != 2 || pages["/a"].Visitors != 1 || pages["/b"].Count != 3 || pages["/b"].Visitors != 1 {
		t.Fatalf("pages = %+v", rt.Pages)
	}
	if c := byValue(rt.Countries); len(c) != 2 || c["NO"].Visitors != 2 || c["SE"].Visitors != 1 {
		t.Fatalf("countries = %+v", rt.Countries)
	}
	if r := byValue(rt.Referrers); r["google.com"].Visitors != 1 {
		t.Fatalf("referrers = %+v", rt.Referrers)
	}
}

// full returns a row's visit metrics and fails the test if metrics=full left any out.
func full(t *testing.T, r store.BreakdownRow) (visits int64, bounce, duration float64) {
	t.Helper()
	if r.Visits == nil || r.BounceRate == nil || r.AvgDuration == nil {
		t.Fatalf("row %q has no visit metrics: %+v", r.Value, r)
	}
	return *r.Visits, *r.BounceRate, *r.AvgDuration
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
	if v, b, d := full(t, all["/"]); v != 2 || b != 0.5 || d != 120 {
		t.Fatalf("unfiltered entry / = %d visits, %v bounce, %vs; want 2, 0.5, 120", v, b, d)
	}

	safari := byValue(get[[]store.BreakdownRow](t, h, q+"&f=browser:is:Safari"))
	if len(safari) != 2 {
		t.Fatalf("Safari entry rows = %+v, want / and /blog", safari)
	}
	if v, b, d := full(t, safari["/"]); safari["/"].Visitors != 1 || v != 1 || b != 1 || d != 0 {
		t.Fatalf("Safari entry / = %+v; the Chrome visit must not count", safari["/"])
	}
	if v, b, _ := full(t, safari["/blog"]); v != 1 || b != 1 {
		t.Fatalf("Safari entry /blog = %+v", safari["/blog"])
	}

	// A page filter keeps whole visits that included the page.
	pricing := byValue(get[[]store.BreakdownRow](t, h, q+"&f=path:is:/pricing"))
	if len(pricing) != 1 {
		t.Fatalf("entry rows for visits that saw /pricing = %+v, want only /", pricing)
	}
	if v, b, d := full(t, pricing["/"]); v != 1 || b != 0 || d != 240 {
		t.Fatalf("entry / for visits that saw /pricing = %d, %v, %vs; want 1, 0, 240", v, b, d)
	}
}

func TestSiteActivityFields(t *testing.T) {
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	empty, emptyBase := newTestAPI(t, now, nil)
	w := httptest.NewRecorder()
	empty.ServeHTTP(w, httptest.NewRequest(http.MethodGet, emptyBase, nil))
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	// The dashboard tells "no data yet" apart from a missing field, so null must be sent.
	for _, k := range []string{"first_event_at", "last_event_at"} {
		if v, ok := raw[k]; !ok || v != nil {
			t.Fatalf("%s = %v (present %v), want null", k, v, ok)
		}
	}

	h, base := newTestAPI(t, now, []store.Event{
		{Time: now.Add(-3 * time.Hour), VisitorID: 1, Path: "/"},
		{Time: now.Add(-time.Minute), VisitorID: 2, Path: "/"},
	})
	site := get[siteJSON](t, h, base)
	if site.FirstEventAt == nil || !site.FirstEventAt.Equal(now.Add(-3*time.Hour)) ||
		site.LastEventAt == nil || !site.LastEventAt.Equal(now.Add(-time.Minute)) {
		t.Fatalf("site = %+v, want events from 09:00 to 11:59", site)
	}
	list := get[[]siteJSON](t, h, "/api/sites")
	if len(list) != 1 || list[0].FirstEventAt == nil || !list[0].LastEventAt.Equal(*site.LastEventAt) {
		t.Fatalf("list = %+v, want the same activity as the site", list)
	}
}
