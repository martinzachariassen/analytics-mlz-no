package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)

type ev struct {
	min      int // minutes after t0
	visitor  int64
	typ      string
	name     string
	path     string
	referrer string
	browser  string
	props    map[string]string
}

func seed(t *testing.T, events []ev) (*Store, string) {
	t.Helper()
	ctx := context.Background()
	st := openTemp(t)
	site, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range events {
		if e.typ == "" {
			e.typ = "pageview"
		}
		err := st.InsertEvent(ctx, Event{
			SiteID: site.ID, Time: t0.Add(time.Duration(e.min) * time.Minute), Type: e.typ, Name: e.name,
			Path: e.path, ReferrerHost: e.referrer, Browser: e.browser, VisitorID: e.visitor, Props: e.props,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return st, site.ID
}

// Visitor 1: one visit from google, 3 pages over 4 minutes, clicks signup.
// Visitor 2: one-page visit (bounce) from linkedin, then a second visit 2h later, direct.
var fixture = []ev{
	{min: 0, visitor: 1, path: "/", referrer: "google.com", browser: "Chrome"},
	{min: 2, visitor: 1, path: "/pricing", browser: "Chrome"},
	{min: 3, visitor: 1, typ: "event", name: "signup", path: "/pricing", browser: "Chrome", props: map[string]string{"plan": "pro"}},
	{min: 4, visitor: 1, path: "/thanks", browser: "Chrome"},
	{min: 5, visitor: 2, path: "/blog", referrer: "linkedin.com", browser: "Safari"},
	{min: 125, visitor: 2, path: "/", browser: "Safari"},
}

func TestSummary(t *testing.T) {
	st, site := seed(t, fixture)
	s, err := st.Summary(context.Background(), site, Range{From: t0, To: t0.Add(24 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if s.Pageviews != 5 || s.Visitors != 2 || s.Visits != 3 {
		t.Fatalf("summary = %+v", s)
	}
	// Two of three visits had a single page view.
	if s.BounceRate < 0.66 || s.BounceRate > 0.67 {
		t.Fatalf("bounce rate = %v", s.BounceRate)
	}
	// Durations 240s, 0s, 0s.
	if s.AvgDuration != 80 {
		t.Fatalf("avg duration = %v", s.AvgDuration)
	}

	empty, err := st.Summary(context.Background(), site, Range{From: t0.Add(-48 * time.Hour), To: t0.Add(-24 * time.Hour)})
	if err != nil || empty != (Summary{}) {
		t.Fatalf("empty range = %+v, %v", empty, err)
	}
}

func TestTimeseries(t *testing.T) {
	st, site := seed(t, fixture)
	bounds := []time.Time{t0, t0.Add(time.Hour), t0.Add(2 * time.Hour), t0.Add(3 * time.Hour)}
	b, err := st.Timeseries(context.Background(), site, bounds)
	if err != nil {
		t.Fatal(err)
	}
	got := [][2]int64{{b[0].Pageviews, b[0].Visitors}, {b[1].Pageviews, b[1].Visitors}, {b[2].Pageviews, b[2].Visitors}}
	want := [][2]int64{{4, 2}, {0, 0}, {1, 1}}
	if len(b) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("timeseries = %v, want %v", got, want)
	}
}

func TestBreakdown(t *testing.T) {
	st, site := seed(t, fixture)
	r := Range{From: t0, To: t0.Add(24 * time.Hour)}
	get := func(dim string, opt BreakdownOptions) []BreakdownRow {
		t.Helper()
		rows, err := st.Breakdown(context.Background(), site, r, dim, opt)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}

	// Sources are attributed per visit using the entry page view.
	refs := get("referrer", BreakdownOptions{})
	if len(refs) != 3 {
		t.Fatalf("referrers = %+v", refs)
	}
	byValue := map[string]BreakdownRow{}
	for _, r := range refs {
		byValue[r.Value] = r
	}
	if byValue["google.com"].Count != 1 || byValue["linkedin.com"].Count != 1 || byValue[""].Count != 1 {
		t.Fatalf("referrers = %+v", refs)
	}

	entry := get("entry", BreakdownOptions{})
	if entry[0].Value != "/" || entry[0].Count != 2 {
		t.Fatalf("entry pages = %+v", entry)
	}

	paths := get("path", BreakdownOptions{Limit: 2})
	if len(paths) != 2 || paths[0].Value != "/" || paths[0].Count != 2 || paths[0].Visitors != 2 {
		t.Fatalf("paths = %+v", paths)
	}

	browsers := get("browser", BreakdownOptions{})
	if browsers[0].Value != "Chrome" && browsers[0].Value != "Safari" || len(browsers) != 2 {
		t.Fatalf("browsers = %+v", browsers)
	}

	events := get("event", BreakdownOptions{})
	if len(events) != 1 || events[0].Value != "signup" || events[0].Count != 1 {
		t.Fatalf("events = %+v", events)
	}

	props := get("prop", BreakdownOptions{Event: "signup", PropKey: "plan"})
	if len(props) != 1 || props[0].Value != "pro" {
		t.Fatalf("props = %+v", props)
	}

	if _, err := st.Breakdown(context.Background(), site, r, "password; DROP TABLE", BreakdownOptions{}); err == nil {
		t.Fatal("unknown dimension must fail")
	}
}

func TestLoginUser(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	now := time.Now()

	u, err := st.LoginUser(ctx, "github", "1", "martin", now)
	if err != nil {
		t.Fatal(err)
	}
	// Rename at GitHub: same id, new login.
	renamed, err := st.LoginUser(ctx, "github", "1", "martin-z", now)
	if err != nil || renamed.ID != u.ID || renamed.Login != "martin-z" {
		t.Fatalf("rename: %+v, %v", renamed, err)
	}
	// Someone else registers "MARTIN-Z" (case-insensitive) with another id.
	if _, err := st.LoginUser(ctx, "github", "2", "MARTIN-Z", now); !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("err = %v, want ErrIdentityConflict", err)
	}
	// The released old name can be taken by a new account.
	if _, err := st.LoginUser(ctx, "github", "3", "martin", now); err != nil {
		t.Fatalf("new account with released name: %v", err)
	}
}
