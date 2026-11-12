package store

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	st, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestNormalizeDomain(t *testing.T) {
	for in, want := range map[string]string{
		"https://www.Example.com/":        "example.com",
		"mlz.no":                          "mlz.no",
		"blog.mlz.no:8080/path":           "blog.mlz.no",
		"  WWW.MLZ.NO  ":                  "mlz.no",
		"example.com.":                    "example.com",
		"ærø.no":                          "xn--r-3fa9c.no",
		"ÆRØ.NO":                          "xn--r-3fa9c.no",
		"localhost":                       "localhost",
		"docs.localhost":                  "docs.localhost",
		"no":                              "",
		"com":                             "",
		"exa mple.com":                    "",
		"a_b.example.com":                 "",
		"<b>.example.com":                 "",
		"":                                "",
		"https://":                        "",
		strings.Repeat("a", 250) + ".com": "",
	} {
		if got := NormalizeDomain(in); got != want {
			t.Errorf("NormalizeDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSiteNamesAndIDs(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	long := strings.Repeat("n", 500)
	site, err := st.CreateSite(ctx, " My\x00 site\n "+long, "a.example")
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(site.Name, "\x00\n") || len(site.Name) > maxNameLen || !strings.HasPrefix(site.Name, "My site") {
		t.Fatalf("name = %q", site.Name)
	}
	if !ValidSiteID(site.ID) {
		t.Fatalf("generated id %q is not valid", site.ID)
	}
	for _, bad := range []string{"", "short", "abcdefghijk0", "ABCDEFGHIJKM", "abcdefghijkmn", "abcdefghijk;"} {
		if ValidSiteID(bad) {
			t.Errorf("ValidSiteID(%q) = true", bad)
		}
	}
	if _, err := st.CreateSite(ctx, "x", "com"); !errors.Is(err, ErrDomainInvalid) {
		t.Fatalf("bare TLD: err = %v", err)
	}
	if _, err := st.CreateSite(ctx, "x", "   "); !errors.Is(err, ErrDomainRequired) {
		t.Fatalf("blank: err = %v", err)
	}
	// Updating with an empty domain keeps it; an empty name falls back to the domain.
	updated, err := st.UpdateSite(ctx, site.ID, "", "")
	if err != nil || updated.Domain != "a.example" || updated.Name != "a.example" {
		t.Fatalf("UpdateSite(empty) = %+v, %v", updated, err)
	}
	if _, err := st.UpdateSite(ctx, "missing", "x", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing: %v", err)
	}
	seen := map[string]bool{}
	for range 1000 {
		id := newID(siteIDLen)
		if seen[id] {
			t.Fatal("duplicate id")
		}
		seen[id] = true
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	for range 2 {
		st, err := Open(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		_ = st.Close()
	}
}

func TestSites(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	site, err := st.CreateSite(ctx, "", "https://mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	if site.Name != "mlz.no" || len(site.ID) != 12 {
		t.Fatalf("unexpected site: %+v", site)
	}
	if _, err := st.CreateSite(ctx, "dup", "www.mlz.no"); err == nil {
		t.Fatal("expected duplicate domain error")
	}
	got, err := st.GetSite(ctx, site.ID)
	if err != nil || got.Domain != "mlz.no" {
		t.Fatalf("GetSite = %+v, %v", got, err)
	}
	if _, err := st.GetSite(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestSiteActivity(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateSite(ctx, "", "other.example")
	if err != nil {
		t.Fatal(err)
	}
	if a, err := st.SiteActivity(ctx, site.ID); err != nil || !a.FirstEvent.IsZero() || !a.LastEvent.IsZero() {
		t.Fatalf("activity before any event = %+v, %v; want zero", a, err)
	}

	t0 := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	for i, ts := range []time.Time{t0.Add(time.Hour), t0, t0.Add(30 * time.Minute)} {
		e := Event{SiteID: site.ID, Time: ts, Type: "pageview", VisitorID: int64(i + 1), Hostname: "mlz.no", Path: "/"}
		if err := st.InsertEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	// A later event on another site must not leak into this one.
	if err := st.InsertEvent(ctx, Event{SiteID: other.ID, Time: t0.Add(5 * time.Hour), Type: "pageview", VisitorID: 9, Hostname: "other.example", Path: "/"}); err != nil {
		t.Fatal(err)
	}
	a, err := st.SiteActivity(ctx, site.ID)
	if err != nil || !a.FirstEvent.Equal(t0) || !a.LastEvent.Equal(t0.Add(time.Hour)) {
		t.Fatalf("activity = %+v, %v; want %s..%s", a, err, t0, t0.Add(time.Hour))
	}

	all, err := st.AllSiteActivity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if all[site.ID] != a || !all[other.ID].FirstEvent.Equal(t0.Add(5*time.Hour)) || len(all) != 2 {
		t.Fatalf("all activity = %+v; want %+v for %s and the other site's event", all, a, site.ID)
	}

	// Both must seek events_site_ts, never scan events: the site list asks for every site.
	assertNoEventScan(t, st, siteActivitySQL, site.ID)
	assertNoEventScan(t, st, allSiteActivitySQL)
}

func assertNoEventScan(t *testing.T, st *Store, query string, args ...any) {
	t.Helper()
	rows, err := st.db.QueryContext(context.Background(), "EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	// A MIN or MAX can also walk events_ts until a row matches, which is a scan too.
	for _, d := range plan {
		if strings.Contains(d, " events ") && !strings.Contains(d, "events_site_ts (site_id=?") {
			t.Fatalf("query plan does not seek events by site: %q", plan)
		}
	}
}

func TestSessions(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	site, _ := st.CreateSite(ctx, "", "mlz.no")
	t0 := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)

	insert := func(at time.Time) {
		t.Helper()
		if err := st.InsertEvent(ctx, Event{SiteID: site.ID, Time: at, Type: "pageview", VisitorID: 42,
			Props: map[string]string{"k": "v"}}); err != nil {
			t.Fatal(err)
		}
	}
	insert(t0)
	insert(t0.Add(10 * time.Minute)) // same session
	insert(t0.Add(50 * time.Minute)) // > 30 min idle: new session

	var sessions int
	if err := st.db.QueryRow(`SELECT COUNT(DISTINCT session_id) FROM events`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 2 {
		t.Fatalf("sessions = %d, want 2", sessions)
	}

	n, err := st.DeleteEventsBefore(ctx, t0.Add(time.Minute))
	if err != nil || n != 1 {
		t.Fatalf("DeleteEventsBefore = %d, %v", n, err)
	}
	var props int
	_ = st.db.QueryRow(`SELECT COUNT(*) FROM event_props`).Scan(&props)
	if props != 2 {
		t.Fatalf("props = %d, want 2 (cascade delete)", props)
	}
}

func TestSaltRotation(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	a, _ := st.SaltForDay(ctx, "2026-11-03")
	b, _ := st.SaltForDay(ctx, "2026-11-03")
	if string(a) != string(b) {
		t.Fatal("salt must be stable within a day")
	}
	c, _ := st.SaltForDay(ctx, "2026-11-04")
	if string(a) == string(c) {
		t.Fatal("salt must change between days")
	}
	var n int
	_ = st.db.QueryRow(`SELECT COUNT(*) FROM salts`).Scan(&n)
	if n != 1 {
		t.Fatalf("salts = %d, want 1 (old salts deleted)", n)
	}
}

func TestSiteCacheInvalidation(t *testing.T) {
	st := openTemp(t)
	ctx := context.Background()

	if _, err := st.GetSite(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	site, err := st.CreateSite(ctx, "A", "a.example")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := st.GetSite(ctx, site.ID); err != nil || got.Domain != "a.example" {
		t.Fatalf("got %+v, %v", got, err)
	}
	if _, err := st.UpdateSite(ctx, site.ID, "A", "b.example"); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.GetSite(ctx, site.ID); got.Domain != "b.example" {
		t.Fatalf("stale cache after update: %q", got.Domain)
	}
	if err := st.DeleteSite(ctx, site.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetSite(ctx, site.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale cache after delete: %v", err)
	}
}

func TestPurgeEvents(t *testing.T) {
	st := openTemp(t)
	ctx := context.Background()
	site, err := st.CreateSite(ctx, "", "a.example")
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for i, path := range []string{"/", "/spam", "/spam", "/"} {
		e := Event{SiteID: site.ID, Time: base.Add(time.Duration(i) * time.Hour), Type: "pageview", Path: path, VisitorID: int64(i + 1),
			Props: map[string]string{"k": "v"}}
		if err := st.InsertEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	// Window covers events 1..3; only /spam is removed.
	n, err := st.PurgeEvents(ctx, PurgeFilter{SiteID: site.ID, From: base.Add(time.Hour), To: base.Add(4 * time.Hour), Path: "/spam"})
	if err != nil || n != 2 {
		t.Fatalf("deleted %d, %v; want 2", n, err)
	}
	n, err = st.PurgeEvents(ctx, PurgeFilter{SiteID: site.ID, From: base, To: base.Add(time.Hour)})
	if err != nil || n != 1 {
		t.Fatalf("deleted %d, %v; want 1", n, err)
	}
	var left, props int
	_ = st.db.QueryRowContext(ctx, `SELECT count(*) FROM events`).Scan(&left)
	_ = st.db.QueryRowContext(ctx, `SELECT count(*) FROM event_props`).Scan(&props)
	if left != 1 || props != 1 {
		t.Fatalf("left %d events, %d props; want 1, 1", left, props)
	}
}

func TestSize(t *testing.T) {
	st := openTemp(t)
	ctx := context.Background()
	site, err := st.CreateSite(ctx, "", "a.example")
	if err != nil {
		t.Fatal(err)
	}
	empty, err := st.Size(ctx)
	if err != nil || empty <= 0 {
		t.Fatalf("size = %d, %v", empty, err)
	}
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 2000; i++ {
		e := Event{SiteID: site.ID, Time: base.Add(time.Duration(i) * time.Second), Type: "pageview", Path: "/some/longer/path", VisitorID: int64(i)}
		if err := st.InsertEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	full, _ := st.Size(ctx)
	if _, err := st.PurgeEvents(ctx, PurgeFilter{SiteID: site.ID, From: base, To: base.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	after, _ := st.Size(ctx)
	if full <= empty || after >= full {
		t.Fatalf("sizes: empty %d, full %d, after purge %d", empty, full, after)
	}
}
