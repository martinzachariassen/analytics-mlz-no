package api

import (
	"net/url"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 3, 15, 0, 0, 0, time.UTC)

func TestParsePeriodDefaults(t *testing.T) {
	p, err := parsePeriod(url.Values{}, now)
	if err != nil {
		t.Fatal(err)
	}
	if p.From != "2026-11-03" || p.To != "2026-11-03" || p.TZ != "UTC" || p.Interval != "hour" {
		t.Fatalf("period = %+v", p)
	}
	if got := len(p.bounds()) - 1; got != 24 {
		t.Fatalf("buckets = %d, want 24", got)
	}
}

func TestParsePeriodAutoInterval(t *testing.T) {
	for _, c := range []struct{ from, to, want string }{
		{"2026-11-01", "2026-11-02", "hour"},
		{"2026-10-01", "2026-10-31", "day"},
		{"2025-11-01", "2026-10-31", "month"},
	} {
		p, err := parsePeriod(url.Values{"from": {c.from}, "to": {c.to}}, now)
		if err != nil || p.Interval != c.want {
			t.Errorf("%s..%s: interval %q, err %v; want %q", c.from, c.to, p.Interval, err, c.want)
		}
	}
}

func TestBoundsFollowDST(t *testing.T) {
	// Europe/Oslo leaves DST on 2026-10-25: that local day has 25 hours.
	p, err := parsePeriod(url.Values{"from": {"2026-10-24"}, "to": {"2026-10-26"}, "tz": {"Europe/Oslo"}, "interval": {"day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	b := p.bounds()
	if len(b) != 4 {
		t.Fatalf("bounds = %v", b)
	}
	if d := b[2].Sub(b[1]); d != 25*time.Hour {
		t.Fatalf("DST day length = %v, want 25h", d)
	}
	for _, t0 := range b {
		if lt := t0.In(p.loc); lt.Hour() != 0 {
			t.Fatalf("bucket %v does not start at local midnight", lt)
		}
	}

	hourly, _ := parsePeriod(url.Values{"from": {"2026-10-25"}, "tz": {"Europe/Oslo"}}, now)
	if got := len(hourly.bounds()) - 1; got != 25 {
		t.Fatalf("hourly buckets on DST day = %d, want 25", got)
	}
}

func TestBoundsMonthly(t *testing.T) {
	p, err := parsePeriod(url.Values{"from": {"2026-01-15"}, "to": {"2026-03-10"}, "interval": {"month"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	b := p.bounds()
	want := []string{"2026-01-15", "2026-02-01", "2026-03-01", "2026-03-11"}
	if len(b) != len(want) {
		t.Fatalf("bounds = %v", b)
	}
	for i, w := range want {
		if got := b[i].Format(time.DateOnly); got != w {
			t.Fatalf("bound %d = %s, want %s", i, got, w)
		}
	}
}

func TestParsePeriodErrors(t *testing.T) {
	for name, q := range map[string]url.Values{
		"bad tz":         {"tz": {"Mars/Olympus"}},
		"bad date":       {"from": {"03.11.2026"}},
		"reversed":       {"from": {"2026-11-03"}, "to": {"2026-11-01"}},
		"too long":       {"from": {"2010-01-01"}, "to": {"2026-01-01"}},
		"hourly too far": {"from": {"2026-01-01"}, "to": {"2026-02-01"}, "interval": {"hour"}},
		"bad interval":   {"interval": {"fortnight"}},
	} {
		if _, err := parsePeriod(q, now); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestBoundsWeekly(t *testing.T) {
	// Wednesday 2026-11-04 to Sunday 2026-11-15: a short first week, then a full one.
	p, err := parsePeriod(url.Values{"from": {"2026-11-04"}, "to": {"2026-11-15"}, "interval": {"week"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	b := p.bounds()
	want := []string{"2026-11-04", "2026-11-09", "2026-11-16"}
	if len(b) != len(want) {
		t.Fatalf("bounds = %v", b)
	}
	for i, w := range want {
		if got := b[i].Format(time.DateOnly); got != w {
			t.Errorf("bound %d = %s, want %s", i, got, w)
		}
	}
}

func TestComparison(t *testing.T) {
	for name, tc := range map[string]struct {
		from, to, mode string
		want           [2]string
	}{
		"7 days":     {"2026-11-01", "2026-11-07", "previous", [2]string{"2026-10-25", "2026-10-31"}},
		"last month": {"2026-10-01", "2026-10-31", "previous", [2]string{"2026-09-01", "2026-09-30"}},
		"12 months":  {"2025-12-01", "2026-11-30", "", [2]string{"2024-12-01", "2025-11-30"}},
		"year":       {"2026-11-01", "2026-11-07", "year", [2]string{"2025-11-01", "2025-11-07"}},
	} {
		p, err := parsePeriod(url.Values{"from": {tc.from}, "to": {tc.to}}, now)
		if err != nil {
			t.Fatal(err)
		}
		c := p.comparison(tc.mode)
		if got := [2]string{c.From, c.To}; got != tc.want {
			t.Errorf("%s: comparison = %v, want %v", name, got, tc.want)
		}
	}
}

func TestParseFilters(t *testing.T) {
	fs, err := parseFilters(url.Values{"f": {"path:is:/a:b", "country:is_not:NO"}})
	if err != nil || len(fs) != 2 || fs[0].Value != "/a:b" || fs[1].Op != "is_not" {
		t.Fatalf("filters = %+v, %v", fs, err)
	}
	for _, bad := range []string{"path", "path:is", "password:is:x", "path:like:x"} {
		if _, err := parseFilters(url.Values{"f": {bad}}); err == nil {
			t.Errorf("%q: expected error", bad)
		}
	}
}
