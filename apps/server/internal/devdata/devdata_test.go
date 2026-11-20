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

// TestSeedCoverage checks the data that makes each dashboard feature testable locally
// (docs/development/seed-data.md).
func TestSeedCoverage(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "coverage.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	site, err := st.CreateSite(ctx, "Blog", "localhost")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 3, 14, 0, 0, 0, time.UTC)
	o := Options{Days: 60, DailyVisits: 80, Hostname: "localhost", Now: now, Location: time.UTC, Pixel: true, Spam: true}
	if _, err := Seed(ctx, st, site.ID, o); err != nil {
		t.Fatal(err)
	}
	all := store.Range{From: now.AddDate(0, 0, -60), To: now}
	values := func(dim string, opt store.BreakdownOptions) map[string]bool {
		t.Helper()
		opt.Limit = store.MaxBreakdownLimit
		rows, err := st.Breakdown(ctx, site.ID, all, dim, opt)
		if err != nil {
			t.Fatalf("Breakdown(%s): %v", dim, err)
		}
		out := map[string]bool{}
		for _, row := range rows {
			out[row.Value] = true
		}
		return out
	}

	if paths := values("path", store.BreakdownOptions{}); len(paths) <= 100 {
		t.Errorf("%d paths, want more than one report page of 100", len(paths))
	} else {
		for _, p := range []string{"/readme", "/wp-login.php", "/blog/ærlig-talt-om-sqlite"} {
			if !paths[p] {
				t.Errorf("no page views of %s", p)
			}
		}
	}
	if hosts := values("hostname", store.BreakdownOptions{}); !hosts["localhost"] || !hosts["www.localhost"] {
		t.Errorf("hostnames %v, want localhost and www.localhost", hosts)
	}
	if refs := values("referrer", store.BreakdownOptions{}); len(refs) <= 20 {
		t.Errorf("%d referrers, want a long tail", len(refs))
	}
	if src := values("utm_source", store.BreakdownOptions{}); !src["podcast"] || !src["newsletter"] {
		t.Errorf("utm sources %v, want podcast and newsletter", src)
	}
	for _, dim := range []string{"country", "browser", "os"} {
		if v := values(dim, store.BreakdownOptions{}); !v[""] {
			t.Errorf("%s has no unknown value", dim)
		}
	}
	if dev := values("device", store.BreakdownOptions{}); !dev["other"] || !dev["tablet"] {
		t.Errorf("devices %v, want other and tablet", dev)
	}
	events := values("event", store.BreakdownOptions{})
	for _, e := range []string{"plan-selected", "signup-start", "email-open", "outbound-link"} {
		if !events[e] {
			t.Errorf("no %s events", e)
		}
	}
	if keys := values("prop_key", store.BreakdownOptions{Event: "plan-selected"}); !keys["plan"] || !keys["seats"] {
		t.Errorf("plan-selected keys %v, want plan and seats", keys)
	}

	// End makes a site that has gone quiet: nothing after it, and no one online now.
	quiet, err := st.CreateSite(ctx, "Old", "old.localhost")
	if err != nil {
		t.Fatal(err)
	}
	end := now.AddDate(0, 0, -45)
	if _, err := Seed(ctx, st, quiet.ID, Options{Days: 60, DailyVisits: 20, Hostname: "old.localhost", Profile: Portfolio, Now: now, End: end, Location: time.UTC}); err != nil {
		t.Fatal(err)
	}
	after, err := st.Summary(ctx, quiet.ID, store.Range{From: end.Add(time.Minute), To: now}, nil)
	if err != nil || after.Pageviews != 0 {
		t.Fatalf("Summary after End = %+v, %v; want nothing", after, err)
	}
	before, err := st.Summary(ctx, quiet.ID, store.Range{From: end.AddDate(0, 0, -15), To: end}, nil)
	if err != nil || before.Pageviews == 0 {
		t.Fatalf("Summary before End = %+v, %v; want traffic", before, err)
	}
}

func TestVisitEventsSplitsLongPauses(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 8))
	start := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	for range 5000 {
		evs := visitEvents(r, "s", "localhost", Blog, newVisitor(r), start, source{})
		for i := 1; i < len(evs); i++ {
			if evs[i].Type == "pageview" && evs[i].Time.Sub(evs[i-1].Time) > store.SessionTimeout {
				return
			}
		}
	}
	t.Fatal("no visit paused longer than the session timeout")
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
