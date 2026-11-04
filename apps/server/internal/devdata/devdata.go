// Package devdata generates realistic-looking synthetic traffic for local development,
// so the dashboard can be explored without a real site sending events.
package devdata

import (
	"context"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// Options controls how much traffic Seed generates.
type Options struct {
	Days        int      // days of history ending now (two years by default, so "Last 12 months" has a comparison)
	DailyVisits int      // average visits per weekday at the end of the period
	Hostname    string   // hostname recorded on events (the site's domain)
	Profile     *Profile // kind of site; nil uses Blog
	Now         time.Time
	Rand        *rand.Rand     // nil uses a fixed seed, so runs are reproducible
	Location    *time.Location // time zone for the daily pattern; nil uses time.Local
}

// Profile describes the kind of site being simulated: its pages and where visitors come from.
type Profile struct {
	entryPages []weighted[string]
	nextPages  []weighted[string]
	sources    []weighted[source]
	// Referrer of the big traffic spike in the last month.
	spikeRef string
}

type weighted[T any] struct {
	v T
	w float64
}

func pick[T any](r *rand.Rand, items []weighted[T]) T {
	var total float64
	for _, it := range items {
		total += it.w
	}
	x := r.Float64() * total
	for _, it := range items {
		if x -= it.w; x < 0 {
			return it.v
		}
	}
	return items[len(items)-1].v
}

// Blog is a personal blog: mostly search and social traffic.
var Blog = &Profile{
	entryPages: []weighted[string]{
		{"/", 40}, {"/blog/sqlite-on-cloud-run", 18}, {"/blog/privacy-first-analytics", 14},
		{"/blog", 8}, {"/projects", 8}, {"/blog/go-1-27-notes", 7}, {"/about", 5},
	},
	nextPages: []weighted[string]{
		{"/blog", 25}, {"/projects", 15}, {"/about", 15}, {"/", 10}, {"/contact", 8},
		{"/blog/sqlite-on-cloud-run", 10}, {"/blog/privacy-first-analytics", 9}, {"/blog/go-1-27-notes", 8},
	},
	sources: []weighted[source]{
		{source{}, 30}, // direct
		{source{ref: "google.com"}, 28},
		{source{ref: "duckduckgo.com"}, 5},
		{source{ref: "bing.com"}, 3},
		{source{ref: "news.ycombinator.com"}, 4},
		{source{ref: "github.com"}, 7},
		{source{ref: "linkedin.com"}, 5},
		{source{ref: "t.co"}, 3},
		{source{ref: "reddit.com"}, 4},
		{source{utmSource: "newsletter", utmMedium: "email", utmCampaign: "monthly"}, 4},
		{source{ref: "linkedin.com", utmSource: "linkedin", utmMedium: "social", utmCampaign: "launch"}, 2},
	},
	spikeRef: "news.ycombinator.com",
}

// Docs is a documentation site: developers arriving from GitHub and search.
var Docs = &Profile{
	entryPages: []weighted[string]{
		{"/", 20}, {"/docs/getting-started", 30}, {"/docs/tracking-script", 18},
		{"/docs/self-hosting", 14}, {"/docs/api", 12}, {"/changelog", 6},
	},
	nextPages: []weighted[string]{
		{"/docs/getting-started", 15}, {"/docs/tracking-script", 20}, {"/docs/custom-events", 15},
		{"/docs/self-hosting", 15}, {"/docs/api", 15}, {"/docs/faq", 10}, {"/changelog", 5},
	},
	sources: []weighted[source]{
		{source{}, 25},
		{source{ref: "github.com"}, 30},
		{source{ref: "google.com"}, 25},
		{source{ref: "duckduckgo.com"}, 6},
		{source{ref: "stackoverflow.com"}, 6},
		{source{ref: "pkg.go.dev"}, 4},
		{source{ref: "reddit.com"}, 4},
	},
	spikeRef: "reddit.com",
}

var (
	countries = []weighted[string]{
		{"NO", 42}, {"SE", 10}, {"DK", 6}, {"DE", 8}, {"GB", 7}, {"US", 14}, {"NL", 4}, {"FI", 3}, {"FR", 3}, {"PL", 3},
	}

	clients = []weighted[client]{
		{client{"Chrome", "macOS", "desktop"}, 22},
		{client{"Safari", "macOS", "desktop"}, 10},
		{client{"Firefox", "macOS", "desktop"}, 4},
		{client{"Chrome", "Windows", "desktop"}, 16},
		{client{"Edge", "Windows", "desktop"}, 7},
		{client{"Firefox", "Windows", "desktop"}, 4},
		{client{"Firefox", "Linux", "desktop"}, 4},
		{client{"Chrome", "Linux", "desktop"}, 3},
		{client{"Safari", "iOS", "mobile"}, 16},
		{client{"Chrome", "Android", "mobile"}, 10},
		{client{"Safari", "iOS", "tablet"}, 3},
		{client{"Samsung Internet", "Android", "mobile"}, 1},
	}

	// Relative traffic per hour of day (local time).
	hourly = []float64{1, 0.6, 0.4, 0.3, 0.3, 0.5, 1.2, 2.5, 4, 5, 5.5, 5.5, 5.2, 5.2, 5, 4.8, 4.5, 4.2, 4.5, 5, 4.8, 4, 3, 1.8}

	outboundURLs = []weighted[string]{
		{"https://github.com/martinzachariassen", 5}, {"https://www.linkedin.com/", 2}, {"https://litestream.io/", 3},
		{"https://cloud.google.com/run", 2},
	}
)

type source struct{ ref, utmSource, utmMedium, utmCampaign string }

type client struct{ browser, os, device string }

// visitor is someone who may come back later the same day (visitor ids rotate daily).
type visitor struct {
	id      int64
	country string
	client  client
}

// returnRate is the share of visits made by someone who already visited that day.
const returnRate = 0.25

// Seed inserts synthetic events for siteID and returns how many were written.
func Seed(ctx context.Context, st *store.Store, siteID string, o Options) (int, error) {
	if o.Days <= 0 {
		o.Days = 730
	}
	if o.DailyVisits <= 0 {
		o.DailyVisits = 80
	}
	if o.Profile == nil {
		o.Profile = Blog
	}
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	if o.Location == nil {
		o.Location = time.Local
	}
	r := o.Rand
	if r == nil {
		r = rand.New(rand.NewPCG(1, 2)) //nolint:gosec // synthetic test data, not security-sensitive
	}

	var hourTotal float64
	for _, w := range hourly {
		hourTotal += w
	}

	// A big spike (e.g. a post on Hacker News) three weeks ago, so it shows in "Last 30 days"
	// without skewing "Last 7 days" vs the week before, and a smaller one earlier.
	bigSpike, smallSpike := 20, o.Days/4
	if o.Days <= 30 {
		bigSpike, smallSpike = o.Days/2, -1
	}

	n := 0
	now := o.Now.In(o.Location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, o.Location)
	for d := o.Days - 1; d >= 0; d-- {
		day := today.AddDate(0, 0, -d)
		mean := float64(o.DailyVisits) * dayFactor(day, d, o.Days)
		spikeRef := ""
		switch d {
		case bigSpike:
			mean, spikeRef = mean*3.5, o.Profile.spikeRef
		case bigSpike - 1:
			mean, spikeRef = mean*1.6, o.Profile.spikeRef // the long tail the day after
		case smallSpike:
			mean, spikeRef = mean*2, "reddit.com"
		}
		visits := int(math.Max(0, mean+r.NormFloat64()*mean*0.15))

		// Start times in order, so returning visitors come back after their first visit.
		starts := make([]time.Time, 0, visits)
		for range visits {
			x := r.Float64() * hourTotal
			hour := 0
			for h, w := range hourly {
				if x -= w; x < 0 {
					hour = h
					break
				}
			}
			start := day.Add(time.Duration(hour)*time.Hour + time.Duration(r.IntN(3600))*time.Second)
			if !start.After(o.Now) {
				starts = append(starts, start)
			}
		}
		slices.SortFunc(starts, func(a, b time.Time) int { return a.Compare(b) })

		var seen []visitor
		for _, start := range starts {
			v, src := newVisitor(r), pick(r, o.Profile.sources)
			if len(seen) > 0 && r.Float64() < returnRate {
				v, src = seen[r.IntN(len(seen))], source{} // returning visitors mostly come back directly
			} else {
				seen = append(seen, v)
			}
			if spikeRef != "" && r.Float64() < 0.55 {
				src = source{ref: spikeRef}
			}
			k, err := visit(ctx, st, r, siteID, o, v, start, src)
			n += k
			if err != nil {
				return n, err
			}
		}
	}

	// A few visitors right now, so the realtime counter shows something.
	for i := range 3 + r.IntN(4) {
		start := o.Now.Add(-time.Duration(i*40+r.IntN(40)) * time.Second)
		k, err := visit(ctx, st, r, siteID, o, newVisitor(r), start, pick(r, o.Profile.sources))
		n += k
		if err != nil {
			return n, err
		}
	}
	return n, nil
}

// dayFactor scales traffic for a day d days before today: growth over the period, quieter
// weekends, a summer dip and a quiet Christmas.
func dayFactor(day time.Time, d, days int) float64 {
	f := 0.35 + 0.65*float64(days-d)/float64(days)
	if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
		f *= 0.65
	}
	switch m, dd := day.Month(), day.Day(); {
	case m == time.July:
		f *= 0.7
	case m == time.December && dd >= 20, m == time.January && dd <= 2:
		f *= 0.55
	}
	return f
}

func newVisitor(r *rand.Rand) visitor {
	return visitor{id: r.Int64(), country: pick(r, countries), client: pick(r, clients)}
}

// visit writes one session: an entry page view, maybe more page views,
// and occasionally custom or outbound-link events.
func visit(ctx context.Context, st *store.Store, r *rand.Rand, siteID string, o Options, v visitor, start time.Time, src source) (int, error) {
	base := store.Event{
		SiteID:    siteID,
		Hostname:  o.Hostname,
		Country:   v.country,
		Browser:   v.client.browser,
		OS:        v.client.os,
		Device:    v.client.device,
		VisitorID: v.id,
	}

	// About 45% bounce; the rest view a few more pages.
	pages := 1
	if r.Float64() > 0.45 {
		pages += 1 + r.IntN(4)
	}

	n := 0
	t := start
	path := pick(r, o.Profile.entryPages)
	for i := range pages {
		if t.After(o.Now) {
			break
		}
		ev := base
		ev.Time, ev.Type, ev.Path = t, "pageview", path
		if i == 0 {
			ev.ReferrerHost, ev.UTMSource, ev.UTMMedium, ev.UTMCampaign = src.ref, src.utmSource, src.utmMedium, src.utmCampaign
		}
		if err := st.InsertEvent(ctx, ev); err != nil {
			return n, err
		}
		n++

		if ev2, ok := maybeEvent(r, base, path, t); ok && !ev2.Time.After(o.Now) {
			if err := st.InsertEvent(ctx, ev2); err != nil {
				return n, err
			}
			n++
		}

		t = t.Add(time.Duration(10+r.IntN(170)) * time.Second)
		path = pick(r, o.Profile.nextPages)
	}
	return n, nil
}

func maybeEvent(r *rand.Rand, base store.Event, path string, t time.Time) (store.Event, bool) {
	ev := base
	ev.Type, ev.Path, ev.Time = "event", path, t.Add(time.Duration(5+r.IntN(60))*time.Second)
	x := r.Float64()
	switch {
	case path == "/contact" && x < 0.3:
		ev.Name, ev.Props = "contact-submit", map[string]string{"topic": pick(r, []weighted[string]{{"work", 3}, {"question", 2}, {"other", 1}})}
	case path == "/" && x < 0.04:
		ev.Name, ev.Props = "newsletter-signup", map[string]string{"position": pick(r, []weighted[string]{{"footer", 3}, {"hero", 2}})}
	case (strings.HasPrefix(path, "/blog/") || strings.HasPrefix(path, "/docs/")) && x < 0.08:
		ev.Name, ev.Props = "copy-code", map[string]string{"lang": pick(r, []weighted[string]{{"go", 4}, {"sql", 2}, {"sh", 2}, {"hcl", 1}})}
	case x < 0.06:
		ev.Name, ev.Props = "outbound-link", map[string]string{"url": pick(r, outboundURLs)}
	default:
		return ev, false
	}
	return ev, true
}
