package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestGoalCRUD(t *testing.T) {
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

	g, err := st.CreateGoal(ctx, site.ID, "event", "  signup ")
	if err != nil || g.Value != "signup" || g.ID == 0 {
		t.Fatalf("create = %+v, %v; want trimmed value and an id", g, err)
	}
	if _, err := st.CreateGoal(ctx, site.ID, "path", "/blog/*"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateGoal(ctx, site.ID, "event", "signup"); !errors.Is(err, ErrGoalExists) {
		t.Fatalf("duplicate: err = %v; want ErrGoalExists", err)
	}
	// The same value under another kind or site is a different goal.
	if _, err := st.CreateGoal(ctx, site.ID, "path", "/signup"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateGoal(ctx, other.ID, "event", "signup"); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []struct{ kind, value string }{
		{"event", ""}, {"event", "   "}, {"event", "\n\t"},
		{"path", "blog"}, {"path", ""}, {"referrer", "google.com"},
	} {
		if _, err := st.CreateGoal(ctx, site.ID, bad.kind, bad.value); !errors.Is(err, ErrGoalInvalid) {
			t.Errorf("CreateGoal(%q, %q) err = %v; want ErrGoalInvalid", bad.kind, bad.value, err)
		}
	}

	// Values are cleaned and cut like ingest cleans what it stores, so a name typed as sent
	// matches. Hash-router paths keep their #.
	for _, c := range []struct{ kind, in, want string }{
		{"event", "a\u202eb\n", "ab"},
		{"event", strings.Repeat("ø", 40), strings.Repeat("ø", 32)},
		{"path", "/#/pricing", "/#/pricing"},
		{"path", "/" + strings.Repeat("x", 2000), "/" + strings.Repeat("x", 1023)},
	} {
		g, err := st.CreateGoal(ctx, other.ID, c.kind, c.in)
		if err != nil || g.Value != c.want {
			t.Errorf("CreateGoal(%q, %q) = %q, %v; want %q", c.kind, c.in, g.Value, err, c.want)
		}
	}

	goals, err := st.ListGoals(ctx, site.ID)
	if err != nil || len(goals) != 3 || goals[0].Value != "signup" || goals[1].Value != "/blog/*" {
		t.Fatalf("list = %+v, %v; want 3 goals, oldest first", goals, err)
	}

	if err := st.DeleteGoal(ctx, other.ID, g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete through another site: err = %v; want ErrNotFound", err)
	}
	if err := st.DeleteGoal(ctx, site.ID, g.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteGoal(ctx, site.ID, g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: err = %v; want ErrNotFound", err)
	}

	// Deleting a site deletes its goals.
	if err := st.DeleteSite(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM goals WHERE site_id = ?`, other.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("goals left after site delete = %d, %v", n, err)
	}
}

func TestGoalLimit(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	for i := range MaxGoals {
		if _, err := st.CreateGoal(ctx, site.ID, "event", "e"+strings.Repeat("x", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.CreateGoal(ctx, site.ID, "event", "one-too-many"); !errors.Is(err, ErrGoalLimit) {
		t.Fatalf("err = %v; want ErrGoalLimit", err)
	}
}

func TestGoalStats(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	add := func(visitor int64, typ, name, path, country string, at time.Duration) {
		t.Helper()
		e := Event{SiteID: site.ID, Time: t0.Add(at), Type: typ, Name: name, Path: path, Country: country,
			Hostname: "mlz.no", VisitorID: visitor}
		if err := st.InsertEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	// Visitor 1 (NO) signs up twice and reads two posts; visitor 2 (NO) reads one post;
	// visitor 3 (SE) signs up from the pricing page; visitor 4 (SE) only sees the home page.
	add(1, "pageview", "", "/blog/a", "NO", 0)
	add(1, "pageview", "", "/blog/b", "NO", time.Minute)
	add(1, "event", "signup", "/blog/b", "NO", 2*time.Minute)
	add(1, "event", "signup", "/blog/b", "NO", 3*time.Minute)
	add(2, "pageview", "", "/blog/a", "NO", 0)
	add(3, "pageview", "", "/pricing", "SE", 0)
	add(3, "event", "signup", "/pricing", "SE", time.Minute)
	add(4, "pageview", "", "/", "SE", 0)
	// Outside the range.
	add(5, "event", "signup", "/", "NO", 48*time.Hour)

	mk := func(kind, value string) Goal {
		g, err := st.CreateGoal(ctx, site.ID, kind, value)
		if err != nil {
			t.Fatal(err)
		}
		return g
	}
	goals := []Goal{
		mk("event", "signup"),
		mk("path", "/blog/*"),
		mk("path", "/blog"), // exact: no page is exactly /blog
		mk("path", "/pricing"),
		mk("event", "never"),
	}
	r := Range{From: t0, To: t0.Add(24 * time.Hour)}

	type want struct{ visitors, completions int64 }
	check := func(name string, f Filters, total int64, w []want) {
		t.Helper()
		gs, err := st.GoalStats(ctx, site.ID, r, f, goals)
		if err != nil {
			t.Fatal(err)
		}
		if gs.Visitors != total {
			t.Errorf("%s: visitors = %d; want %d", name, gs.Visitors, total)
		}
		for i, res := range gs.Goals {
			if res.Goal.ID != goals[i].ID || res.Visitors != w[i].visitors || res.Completions != w[i].completions {
				t.Errorf("%s: goal %s %q = %d visitors, %d completions; want %d, %d",
					name, res.Goal.Kind, res.Goal.Value, res.Visitors, res.Completions, w[i].visitors, w[i].completions)
			}
		}
	}
	check("all", nil, 4, []want{{2, 3}, {2, 3}, {0, 0}, {1, 1}, {0, 0}})
	check("country", Filters{{Dim: "country", Op: "is", Value: "SE"}}, 2, []want{{1, 1}, {0, 0}, {0, 0}, {1, 1}, {0, 0}})
	// A path filter selects whole visits: visitor 1's signups happened in a visit that viewed /blog/a.
	check("path", Filters{{Dim: "path", Op: "is", Value: "/blog/a"}}, 2, []want{{1, 2}, {2, 3}, {0, 0}, {0, 0}, {0, 0}})

	// is_not keeps visits without the page, so visitor 1's signups drop out; the
	// denominator stays the KPI strip's visitors, which still include visitor 1.
	check("path is_not", Filters{{Dim: "path", Op: "is_not", Value: "/blog/a"}}, 3, []want{{1, 1}, {0, 0}, {0, 0}, {1, 1}, {0, 0}})
	for _, f := range []Filters{nil, {{Dim: "path", Op: "is_not", Value: "/blog/a"}}, {{Dim: "event", Op: "is", Value: "signup"}}} {
		sum, err := st.Summary(ctx, site.ID, r, f)
		if err != nil {
			t.Fatal(err)
		}
		gs, err := st.GoalStats(ctx, site.ID, r, f, goals)
		if err != nil || gs.Visitors != sum.Visitors {
			t.Errorf("filters %v: goal visitors = %d, %v; want Summary's %d", f, gs.Visitors, err, sum.Visitors)
		}
	}

	for _, f := range []Filters{nil, {{Dim: "path", Op: "is_not", Value: "/blog/a"}}, {{Dim: "entry", Op: "is", Value: "/"}}} {
		q, args := goalStatsSQL(site.ID, r, f, goals)
		assertNoEventScan(t, st, q, args...)
	}

	if gs, err := st.GoalStats(ctx, site.ID, r, nil, nil); err != nil || gs.Visitors != 4 || len(gs.Goals) != 0 {
		t.Fatalf("no goals = %+v, %v", gs, err)
	}
}

func TestGlobPatternOnlyStarIsSpecial(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	for _, c := range []struct {
		goal, path string
		match      bool
	}{
		{"/blog/*", "/blog/a/b", true},
		{"/blog/*", "/blog", false},
		{"/*/edit", "/posts/1/edit", true},
		{"/a?c", "/abc", false},
		{"/a?c", "/a?c", true},
		{"/[ab]", "/a", false},
		{"/[ab]", "/[ab]", true},
		{"/Blog/*", "/blog/a", false},
	} {
		var got bool
		if err := st.db.QueryRowContext(ctx, `SELECT ? GLOB ?`, c.path, globPattern(c.goal)).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != c.match {
			t.Errorf("goal %q vs path %q = %v; want %v", c.goal, c.path, got, c.match)
		}
	}
}
