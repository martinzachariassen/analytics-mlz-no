package main

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func TestMaintainRotatesSaltWithoutTraffic(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	day1 := time.Date(2026, 11, 12, 23, 59, 0, 0, time.UTC)
	old, err := st.SaltForDay(ctx, day1.Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	u, _ := st.LoginUser(ctx, "github", "1", "martin", day1)
	_ = st.CreateSession(ctx, []byte("expired"), u.ID, day1, day1.Add(time.Minute))

	// No events arrive; the maintenance run after midnight replaces the salt on its own.
	day2 := day1.Add(2 * time.Minute)
	maintain(ctx, st, 0, day2, log)

	if again, _ := st.SaltForDay(ctx, day1.Format(time.DateOnly)); bytes.Equal(again, old) {
		t.Fatal("yesterday's salt survived the maintenance run")
	}
	if _, _, err := st.UserBySession(ctx, []byte("expired"), day1); err == nil {
		t.Fatal("expired session was not deleted")
	}
}

func TestMaintainDeletesEventsPastRetention(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	for _, age := range []int{31, 29} {
		at := now.AddDate(0, 0, -age)
		if err := st.InsertEvent(ctx, store.Event{SiteID: site.ID, Time: at, Type: "pageview", Path: "/", VisitorID: int64(age)}); err != nil {
			t.Fatal(err)
		}
	}

	maintain(ctx, st, 0, now, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if a, _ := st.SiteActivity(ctx, site.ID); !a.FirstEvent.Equal(now.AddDate(0, 0, -31)) {
		t.Fatalf("retention 0 deleted events: first event %v", a.FirstEvent)
	}
	maintain(ctx, st, 30, now, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a, _ := st.SiteActivity(ctx, site.ID)
	if !a.FirstEvent.Equal(now.AddDate(0, 0, -29)) || !a.LastEvent.Equal(a.FirstEvent) {
		t.Fatalf("after 30-day retention: first %v, last %v; want only the 29-day-old event", a.FirstEvent, a.LastEvent)
	}
}

func TestUntilNextRun(t *testing.T) {
	for _, c := range []struct {
		now  time.Time
		want time.Duration
	}{
		{time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC), time.Hour},
		{time.Date(2026, 11, 12, 23, 30, 0, 0, time.UTC), 30*time.Minute + time.Second},
		{time.Date(2026, 11, 13, 0, 30, 0, 0, time.FixedZone("CET", 3600)), 30*time.Minute + time.Second},
	} {
		if got := untilNextRun(c.now); got != c.want {
			t.Errorf("untilNextRun(%v) = %v, want %v", c.now, got, c.want)
		}
	}
}
