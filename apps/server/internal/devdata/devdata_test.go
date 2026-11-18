package devdata

import (
	"context"
	"math/rand/v2"
	"path/filepath"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func TestSeed(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "seed.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	site, err := st.CreateSite(ctx, "Demo", "localhost")
	if err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 11, 3, 14, 0, 0, 0, time.UTC)
	n, err := Seed(ctx, st, site.ID, Options{Days: 7, DailyVisits: 20, Hostname: "localhost", Now: now, Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	if n < 100 {
		t.Fatalf("Seed wrote %d events, want at least 100", n)
	}

	live, err := st.CurrentVisitors(ctx, site.ID, now.Add(-5*time.Minute))
	if err != nil || live == 0 {
		t.Fatalf("CurrentVisitors = %d, %v; want recent visitors", live, err)
	}

	// Some visitors come back the same day, so there are more visits than visitors.
	sum, err := st.Summary(ctx, site.ID, store.Range{From: now.AddDate(0, 0, -7), To: now}, nil)
	if err != nil || sum.Visitors >= sum.Visits {
		t.Fatalf("Summary = %+v, %v; want fewer visitors than visits", sum, err)
	}
}

func TestLiveRate(t *testing.T) {
	o := withDefaults(Options{DailyVisits: 24000, Location: time.UTC})
	night := liveRate(o, time.Date(2026, 11, 3, 3, 0, 0, 0, time.UTC))
	day := liveRate(o, time.Date(2026, 11, 3, 11, 0, 0, 0, time.UTC))
	if night >= day {
		t.Fatalf("liveRate at 03:00 = %.1f, at 11:00 = %.1f; want more visits by day", night, day)
	}
	if quiet := liveRate(withDefaults(Options{DailyVisits: 1, Location: time.UTC}), time.Now()); quiet != liveFloor {
		t.Fatalf("liveRate for a quiet site = %.2f, want the floor %.0f", quiet, liveFloor)
	}
}

func TestPoisson(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	const n, mean = 20000, 3.0
	total := 0
	for range n {
		total += poisson(r, mean)
	}
	if got := float64(total) / n; got < mean*0.97 || got > mean*1.03 {
		t.Fatalf("poisson mean = %.3f, want about %.1f", got, mean)
	}
}
