// Package devdata generates realistic-looking synthetic traffic for local development,
// so the dashboard can be explored without a real site sending events.
package devdata

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// Options controls how much traffic Seed generates.
type Options struct {
	Days        int      // days of history ending at Now (two years by default, so "Last 12 months" has a comparison)
	DailyVisits int      // average visits per weekday at the end of the period
	Hostname    string   // hostname recorded on events (the site's domain)
	Profile     *Profile // kind of site; nil uses Blog
	Now         time.Time
	// End stops Seed's traffic at this time instead of Now, for a site that has gone quiet.
	End      time.Time
	Rand     *rand.Rand     // nil uses a fixed seed, so runs are reproducible
	Location *time.Location // time zone for the daily pattern; nil uses time.Local
	// Pixel adds README views and email opens through image proxies, stored the way
	// GET /api/pixel.gif stores them: no country, browser, OS or device.
	Pixel bool
	// Spam adds a burst of probing requests from one visitor three days ago, to try
	// `analytics events purge` on.
	Spam bool
}

// Profile describes the kind of site being simulated: its pages and where visitors come from.
type Profile struct {
	entryPages []weighted[string]
	nextPages  []weighted[string]
	sources    []weighted[source]
	// Subdomains some visits arrive on, prepended to Options.Hostname ("" is the domain itself).
	hostPrefixes []weighted[string]
	// Referrer of the big traffic spike in the last month.
	spikeRef string
}

// longTail returns n paths built by name(i), weighted 1/(i+1) and scaled to sum to total,
// so a few are popular and most are seen now and then.
func longTail(n int, total float64, name func(i int) string) []weighted[string] {
	var h float64
	for i := range n {
		h += 1 / float64(i+1)
	}
	out := make([]weighted[string], n)
	for i := range n {
		out[i] = weighted[string]{name(i), total / h / float64(i+1)}
	}
	return out
}

var (
	blogTopics = []string{
		"sqlite", "go", "litestream", "cloud-run", "privacy", "terraform", "react", "vite", "tailwind",
		"postgres", "docker", "github-actions", "observability", "caching", "testing", "http",
	}
	// Enough posts that the pages report needs more than one page of 100 rows.
	blogPosts = longTail(140, 20, func(i int) string {
		return fmt.Sprintf("/blog/notes-on-%s-%d", blogTopics[i%len(blogTopics)], i/len(blogTopics)+1)
	})
	docsSections = []string{"guides", "reference", "integrations", "self-hosting", "api", "cli"}
	docsPages    = []string{"install", "configure", "upgrade", "troubleshooting", "overview", "examples", "faq", "limits", "security", "migrate"}
	docsTail     = longTail(len(docsSections)*len(docsPages), 25, func(i int) string {
		return "/docs/" + docsSections[i%len(docsSections)] + "/" + docsPages[i/len(docsSections)]
	})
	// A long tail of small referrers, so the sources report has more than the top ten.
	smallReferrers = func() []weighted[source] {
		names := []string{
			"lobste.rs", "dev.to", "hashnode.com", "medium.com", "substack.com", "mastodon.social", "fosstodon.org",
			"hachyderm.io", "bsky.app", "threads.net", "facebook.com", "instagram.com", "youtube.com", "slack.com",
			"discord.com", "teams.microsoft.com", "notion.so", "feedly.com", "inoreader.com", "newsblur.com",
			"kagi.com", "ecosia.org", "search.brave.com", "startpage.com", "yandex.ru", "baidu.com", "naver.com",
			"qwant.com", "perplexity.ai", "chatgpt.com", "claude.ai", "gemini.google.com", "golangweekly.com",
			"changelog.com", "tldr.tech", "hn.algolia.com", "tildes.net", "kode24.no", "digi.no", "vg.no",
		}
		out := make([]weighted[source], len(names))
		for i, n := range names {
			out[i] = weighted[source]{source{ref: n}, 0.6 / float64(1+i%4)}
		}
		return out
	}()
)

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
	entryPages: append([]weighted[string]{
		{"/", 40}, {"/blog/sqlite-on-cloud-run", 18}, {"/blog/privacy-first-analytics", 14},
		{"/blog", 8}, {"/projects", 8}, {"/blog/go-1-27-notes", 7}, {"/about", 5}, {"/pricing", 3},
		{"/blog/ærlig-talt-om-sqlite", 2},
		{"/blog/2026/11/running-sqlite-on-serverless-containers-without-losing-a-single-write", 1},
	}, blogPosts...),
	nextPages: append([]weighted[string]{
		{"/blog", 25}, {"/projects", 15}, {"/about", 15}, {"/", 10}, {"/contact", 8}, {"/pricing", 6},
		{"/blog/sqlite-on-cloud-run", 10}, {"/blog/privacy-first-analytics", 9}, {"/blog/go-1-27-notes", 8},
	}, blogPosts...),
	sources: append([]weighted[source]{
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
		{source{utmSource: "newsletter", utmMedium: "email", utmCampaign: "autumn-launch"}, 1.5},
		{source{ref: "mastodon.social", utmSource: "mastodon", utmMedium: "social", utmCampaign: "autumn-launch"}, 1},
		{source{utmSource: "podcast"}, 0.5}, // a source without medium or campaign
	}, smallReferrers...),
	hostPrefixes: []weighted[string]{{"", 90}, {"www.", 8}, {"staging.", 2}},
	spikeRef:     "news.ycombinator.com",
}

// Docs is a documentation site: developers arriving from GitHub and search.
var Docs = &Profile{
	entryPages: append([]weighted[string]{
		{"/", 20}, {"/docs/getting-started", 30}, {"/docs/tracking-script", 18},
		{"/docs/self-hosting", 14}, {"/docs/api", 12}, {"/changelog", 6},
	}, docsTail...),
	nextPages: append([]weighted[string]{
		{"/docs/getting-started", 15}, {"/docs/tracking-script", 20}, {"/docs/custom-events", 15},
		{"/docs/self-hosting", 15}, {"/docs/api", 15}, {"/docs/faq", 10}, {"/changelog", 5},
	}, docsTail...),
	sources: []weighted[source]{
		{source{}, 25},
		{source{ref: "github.com"}, 30},
		{source{ref: "google.com"}, 25},
		{source{ref: "duckduckgo.com"}, 6},
		{source{ref: "stackoverflow.com"}, 6},
		{source{ref: "pkg.go.dev"}, 4},
		{source{ref: "reddit.com"}, 4},
		{source{ref: "github.com", utmSource: "github", utmMedium: "referral", utmCampaign: "readme"}, 3},
		{source{utmSource: "newsletter", utmMedium: "email", utmCampaign: "docs-update"}, 1.5},
	},
	spikeRef: "reddit.com",
}

// Portfolio is a small personal portfolio.
var Portfolio = &Profile{
	entryPages: []weighted[string]{{"/", 60}, {"/work", 15}, {"/work/fjord-labs", 10}, {"/cv", 10}, {"/contact", 5}},
	nextPages:  []weighted[string]{{"/work", 30}, {"/work/fjord-labs", 20}, {"/work/mlz", 15}, {"/cv", 20}, {"/contact", 15}},
	sources: []weighted[source]{
		{source{}, 40}, {source{ref: "google.com"}, 25}, {source{ref: "linkedin.com"}, 25}, {source{ref: "github.com"}, 10},
	},
	spikeRef: "linkedin.com",
}

var (
	countries = []weighted[string]{
		{"NO", 42}, {"SE", 10}, {"DK", 6}, {"DE", 8}, {"GB", 7}, {"US", 14}, {"NL", 4}, {"FI", 3}, {"FR", 3}, {"PL", 3},
		{"ES", 1.5}, {"IT", 1.5}, {"CA", 2}, {"BR", 1.5}, {"MX", 0.6}, {"AR", 0.4}, {"IN", 2}, {"JP", 1.2},
		{"KR", 0.6}, {"SG", 0.5}, {"AU", 1.2}, {"NZ", 0.3}, {"ZA", 0.4}, {"NG", 0.3}, {"KE", 0.2}, {"EG", 0.2},
		{"", 2.2}, // not found in the GeoIP database
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
		{client{"Samsung Browser", "Android", "mobile"}, 1},
		{client{"Chrome", "Android", "tablet"}, 1},
		{client{"Chrome", "ChromeOS", "desktop"}, 1},
		{client{"Opera", "Windows", "desktop"}, 0.7},
		{client{"Vivaldi", "Linux", "desktop"}, 0.3},
		{client{"Chrome", "Linux", "other"}, 0.5}, // a TV or a console
		{client{"", "", "other"}, 1},              // a user agent the parser does not know
	}

	searchQueries = []string{
		"install", "docker", "goals", "pixel", "csv export", "retention", "litestream", "backup", "restore",
		"api key", "oauth", "github login", "custom events", "spa", "hash routing", "utm", "bots", "rate limit",
		"proxy", "nginx", "caddy", "cloud run", "terraform", "self-hosting", "upgrade", "purge", "timezone",
		"country", "privacy", "gdpr",
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

var hourTotal = func() float64 {
	var t float64
	for _, w := range hourly {
		t += w
	}
	return t
}()

// returnRate is the share of visits made by someone who already visited that day.
const returnRate = 0.25

// withDefaults fills in the options left at their zero value.
func withDefaults(o Options) Options {
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
	return o
}

// Seed inserts synthetic events for siteID and returns how many were written.
func Seed(ctx context.Context, st *store.Store, siteID string, o Options) (int, error) {
	o = withDefaults(o)
	quiet := !o.End.IsZero() && o.End.Before(o.Now)
	if quiet {
		o.Now = o.End
	}
	r := o.Rand
	if r == nil {
		r = rand.New(rand.NewPCG(1, 2)) //nolint:gosec // synthetic test data, not security-sensitive
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

	if o.Pixel {
		k, err := seedPixel(ctx, st, r, siteID, o, today)
		n += k
		if err != nil {
			return n, err
		}
	}
	if o.Spam && o.Days > 3 {
		k, err := seedSpam(ctx, st, r, siteID, o, today.AddDate(0, 0, -3))
		n += k
		if err != nil {
			return n, err
		}
	}
	if quiet {
		return n, nil
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

// seedPixel adds what the tracking pixel records: README views through GitHub's image proxy
// on most days, and a monthly newsletter whose opens arrive through Gmail's proxy. Behind a
// proxy, ingest stores no country, browser, OS or device, and the proxy's few addresses
// make few visitors.
func seedPixel(ctx context.Context, st *store.Store, r *rand.Rand, siteID string, o Options, today time.Time) (int, error) {
	n := 0
	insert := func(ev store.Event) error {
		if ev.Time.After(o.Now) {
			return nil
		}
		ev.SiteID, ev.Hostname = siteID, o.Hostname
		if err := st.InsertEvent(ctx, ev); err != nil {
			return err
		}
		n++
		return nil
	}
	for d := o.Days - 1; d >= 0; d-- {
		day := today.AddDate(0, 0, -d)
		for range poisson(r, float64(o.DailyVisits)*0.06*dayFactor(day, d, o.Days)) {
			t := day.Add(time.Duration(r.IntN(86400)) * time.Second)
			if err := insert(store.Event{Time: t, Type: "pageview", Path: "/readme", ReferrerHost: "github.com", VisitorID: int64(1000 + r.IntN(3))}); err != nil {
				return n, err
			}
		}
		if day.Day() != 1 {
			continue
		}
		for range poisson(r, float64(o.DailyVisits)*0.5) {
			ev := store.Event{
				Time: day.Add(9*time.Hour + time.Duration(r.ExpFloat64()*4*3600)*time.Second), Type: "event",
				Name: "email-open", Path: "/newsletter", ReferrerHost: "mail.google.com",
				UTMSource: "newsletter", UTMMedium: "email", UTMCampaign: "monthly", VisitorID: int64(2000 + r.IntN(5)),
			}
			if err := insert(ev); err != nil {
				return n, err
			}
		}
	}
	return n, nil
}

// seedSpam adds a scanner probing for well-known admin paths: one visitor, a few dozen
// page views in twenty minutes at night.
func seedSpam(ctx context.Context, st *store.Store, r *rand.Rand, siteID string, o Options, day time.Time) (int, error) {
	paths := []string{"/wp-login.php", "/.env", "/xmlrpc.php", "/wp-admin/", "/.git/config", "/phpmyadmin/"}
	start := day.Add(3*time.Hour + 12*time.Minute)
	n := 0
	for i := range 48 {
		ev := store.Event{
			SiteID: siteID, Time: start.Add(time.Duration(i*25) * time.Second), Type: "pageview", Hostname: o.Hostname,
			Path: paths[r.IntN(len(paths))], Country: "US", Browser: "Chrome", OS: "Linux", Device: "desktop", VisitorID: 4242,
		}
		if err := st.InsertEvent(ctx, ev); err != nil {
			return n, err
		}
		n++
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

// visitHost is the hostname one visit arrives on.
func visitHost(r *rand.Rand, p *Profile, domain string) string {
	if len(p.hostPrefixes) == 0 {
		return domain
	}
	return pick(r, p.hostPrefixes) + domain
}

// visit writes the part of one session that has happened by o.Now.
func visit(ctx context.Context, st *store.Store, r *rand.Rand, siteID string, o Options, v visitor, start time.Time, src source) (int, error) {
	n := 0
	for _, ev := range visitEvents(r, siteID, o.Hostname, o.Profile, v, start, src) {
		if ev.Time.After(o.Now) {
			continue
		}
		if err := st.InsertEvent(ctx, ev); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// visitEvents builds one session: an entry page view, maybe more page views,
// and occasionally custom or outbound-link events.
func visitEvents(r *rand.Rand, siteID, hostname string, p *Profile, v visitor, start time.Time, src source) []store.Event {
	base := store.Event{
		SiteID:    siteID,
		Hostname:  visitHost(r, p, hostname),
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

	var events []store.Event
	t := start
	path := pick(r, p.entryPages)
	for i := range pages {
		ev := base
		ev.Time, ev.Type, ev.Path = t, "pageview", path
		if i == 0 {
			ev.ReferrerHost, ev.UTMSource, ev.UTMMedium, ev.UTMCampaign = src.ref, src.utmSource, src.utmMedium, src.utmCampaign
		}
		events = append(events, ev)
		if ev2, ok := maybeEvent(r, base, path, t); ok {
			events = append(events, ev2)
		}
		gap := time.Duration(10+r.IntN(170)) * time.Second
		if r.Float64() < 0.01 {
			// Left the tab open and came back: past store.SessionTimeout, so a second session.
			gap = store.SessionTimeout + time.Duration(1+r.IntN(60))*time.Minute
		}
		t = t.Add(gap)
		path = pick(r, p.nextPages)
	}
	return events
}

// Live keeps visits arriving for siteID until ctx is done, at the rate Seed would give
// the current hour, but at least liveFloor a minute so Realtime always has something to
// show. Each event is written when its time comes, not ahead of time.
func Live(ctx context.Context, st *store.Store, siteID string, o Options) error {
	o = withDefaults(o)
	r := o.Rand
	if r == nil {
		r = rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 3)) //nolint:gosec // synthetic test data, not security-sensitive
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var queue []store.Event
	last := time.Now()
	for {
		var now time.Time
		select {
		case <-ctx.Done():
			return nil
		case now = <-tick.C:
		}
		for k := poisson(r, liveRate(o, now)*now.Sub(last).Minutes()); k > 0; k-- {
			queue = append(queue, visitEvents(r, siteID, o.Hostname, o.Profile, newVisitor(r), now, pick(r, o.Profile.sources))...)
		}
		last = now
		slices.SortFunc(queue, func(a, b store.Event) int { return a.Time.Compare(b.Time) })
		i := 0
		for ; i < len(queue) && !queue[i].Time.After(now); i++ {
			if err := st.InsertEvent(ctx, queue[i]); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return err
			}
		}
		queue = queue[i:]
	}
}

// liveFloor is the fewest new visits a minute Live sends.
const liveFloor = 1.0

// liveRate is the expected number of new visits a minute at t.
func liveRate(o Options, t time.Time) float64 {
	local := t.In(o.Location)
	perDay := float64(o.DailyVisits) * dayFactor(local, 0, o.Days)
	return math.Max(liveFloor, perDay*hourly[local.Hour()]/hourTotal/60)
}

// poisson draws how many visits start in an interval where mean are expected.
func poisson(r *rand.Rand, mean float64) int {
	limit, p, k := math.Exp(-mean), r.Float64(), 0
	for p > limit {
		p *= r.Float64()
		k++
	}
	return k
}

func maybeEvent(r *rand.Rand, base store.Event, path string, t time.Time) (store.Event, bool) {
	ev := base
	ev.Type, ev.Path, ev.Time = "event", path, t.Add(time.Duration(5+r.IntN(60))*time.Second)
	x := r.Float64()
	switch {
	case path == "/contact" && x < 0.3:
		ev.Name, ev.Props = "contact-submit", map[string]string{"topic": pick(r, []weighted[string]{{"work", 3}, {"question", 2}, {"other", 1}})}
	case path == "/" && x < 0.04:
		ev.Name, ev.Props = "newsletter-signup", map[string]string{"position": pick(r, []weighted[string]{{"footer", 3}, {"hero", 2}, {"sidebar", 1}, {"popup", 0.5}})}
	case path == "/pricing" && x < 0.15:
		ev.Name, ev.Props = "plan-selected", map[string]string{
			"plan":  pick(r, []weighted[string]{{"hobby", 5}, {"pro", 3}, {"team", 1}}),
			"seats": pick(r, []weighted[string]{{"1", 5}, {"3", 2}, {"10", 1}}),
		}
	case path == "/pricing" && x < 0.25:
		ev.Name = "signup-start" // an event without properties
	case strings.HasPrefix(path, "/docs/") && x < 0.05:
		ev.Name, ev.Props = "search", map[string]string{"query": searchQueries[min(len(searchQueries)-1, int(r.ExpFloat64()*6))]}
	case (strings.HasPrefix(path, "/blog/") || strings.HasPrefix(path, "/docs/")) && x < 0.08:
		ev.Name, ev.Props = "copy-code", map[string]string{"lang": pick(r, []weighted[string]{{"go", 4}, {"sql", 2}, {"sh", 2}, {"hcl", 1}})}
	case x < 0.06:
		ev.Name, ev.Props = "outbound-link", map[string]string{"url": pick(r, outboundURLs)}
	default:
		return ev, false
	}
	return ev, true
}
