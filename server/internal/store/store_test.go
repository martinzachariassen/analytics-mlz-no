package store

import (
	"context"
	"errors"
	"path/filepath"
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
		"https://www.Example.com/": "example.com",
		"mlz.no":                   "mlz.no",
		"blog.mlz.no:8080/path":    "blog.mlz.no",
		"  WWW.MLZ.NO  ":           "mlz.no",
	} {
		if got := NormalizeDomain(in); got != want {
			t.Errorf("NormalizeDomain(%q) = %q, want %q", in, got, want)
		}
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
