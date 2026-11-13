// Package ingest implements the public event collection endpoints: POST /api/event for the
// tracking script and GET /api/pixel.gif for places that cannot run it.
package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mileusna/useragent"
	"golang.org/x/time/rate"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/text"
)

// Limits on incoming payloads.
const (
	maxBodyBytes  = 8 << 10
	maxNameLen    = 64
	maxPathLen    = 1024
	maxProps      = 20
	maxPropKeyLen = 64
	maxPropValLen = 256
)

// Payload is the JSON body sent by the tracker.
type Payload struct {
	Site     string                     `json:"site"`
	Type     string                     `json:"type"`           // "pageview" (default) or "event"
	Name     string                     `json:"name,omitempty"` // required for "event"
	URL      string                     `json:"url"`
	Referrer string                     `json:"referrer,omitempty"`
	Props    map[string]json.RawMessage `json:"props,omitempty"`
}

// Store is the subset of the store used by the handler.
type Store interface {
	GetSite(ctx context.Context, id string) (store.Site, error)
	InsertEvent(ctx context.Context, e store.Event) error
}

// VisitorHasher computes anonymous visitor ids.
type VisitorHasher interface {
	ID(ctx context.Context, siteID, ip, userAgent string) (int64, error)
}

// Handler serves POST /api/event (ServeHTTP) and GET /api/pixel.gif (Pixel).
//
// Abuse protection, in request order (every limiter is optional):
//   - Limiter: per client IP. Rejected with 429.
//   - ProxyLimiter: per client IP for pixel requests from a known image proxy, in place of
//     Limiter: a proxy carries many readers from a few addresses. Falls back to Limiter.
//   - PeerLimiter: per PeerIP (the address the nearest proxy saw, which cannot be forged).
//     Catches clients that bypass a proxy and forge X-Forwarded-For. Rejected with 429.
//   - Global: across all clients, protects the single SQLite writer. Rejected with 503.
//   - VisitorLimiter: per site and visitor id. Excess is accepted with 202 but not stored,
//     so a script replaying one visitor cannot inflate counts and gets no signal.
//   - WriteSlots: bounds concurrent inserts; a request that waits too long gets 503.
//   - Paused: when it reports true (e.g. the database is over its size limit), 503.
type Handler struct {
	Store          Store
	Visitors       VisitorHasher
	Geo            *geo.Locator
	Limiter        *httpx.RateLimiter
	ProxyLimiter   *httpx.RateLimiter
	PeerLimiter    *httpx.RateLimiter
	Global         *rate.Limiter
	VisitorLimiter *httpx.RateLimiter
	WriteSlots     chan struct{}
	Paused         func() bool
	ProxyHops      int
	Log            *slog.Logger
	Now            func() time.Time
}

// writeWait is how long a request waits for a free write slot before giving up.
const writeWait = 2 * time.Second

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	fail := func(status int) {
		switch status {
		case http.StatusServiceUnavailable:
			unavailable(w)
		case http.StatusTooManyRequests:
			http.Error(w, "too many requests", status)
		default:
			http.Error(w, "internal error", status)
		}
	}
	ip, ok := h.admit(r, h.Limiter, fail)
	if !ok {
		return
	}

	ua := r.UserAgent()
	parsedUA := useragent.Parse(ua)
	if isBot(ua, parsedUA) {
		// Accept silently so bots get no signal, but don't store anything.
		h.reject(r, slog.LevelDebug, "bot", http.StatusAccepted, "")
		w.WriteHeader(http.StatusAccepted)
		return
	}

	// sendBeacon uses text/plain to avoid a CORS preflight, so accept any content type.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		h.reject(r, slog.LevelInfo, "payload too large", http.StatusRequestEntityTooLarge, "")
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	var p Payload
	if err := json.Unmarshal(body, &p); err != nil {
		h.reject(r, slog.LevelInfo, "invalid json", http.StatusBadRequest, "")
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	ev, err := h.buildEvent(r.Context(), r, p, ip, ua, parsedUA)
	var br badRequest
	if errors.As(err, &br) {
		h.reject(r, slog.LevelInfo, br.reason, http.StatusBadRequest, p.Site)
		http.Error(w, br.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		h.Log.Error("build event", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.record(r, ev, true, func() { w.WriteHeader(http.StatusAccepted) }, fail)
}

// admit applies the address limits (the peer limiter, then lim per client), the global limit
// and the pause switch, in that order. When the request must stop it calls fail with the
// status (429 or 503) and reports false.
func (h *Handler) admit(r *http.Request, lim *httpx.RateLimiter, fail func(status int)) (ip string, ok bool) {
	// The peer limit runs first: its key cannot be forged, so a flood of forged client
	// addresses is cut off before each one gets its own limiter entry.
	ip = httpx.ClientIP(r, h.ProxyHops)
	if h.PeerLimiter != nil {
		if peer := httpx.PeerIP(r, h.ProxyHops); peer != ip && !h.PeerLimiter.Allow(peer) {
			h.reject(r, slog.LevelDebug, "rate limit (upstream address)", http.StatusTooManyRequests, "")
			fail(http.StatusTooManyRequests)
			return "", false
		}
	}
	if lim != nil && !lim.Allow(ip) {
		h.reject(r, slog.LevelDebug, "rate limit (client)", http.StatusTooManyRequests, "")
		fail(http.StatusTooManyRequests)
		return "", false
	}
	if h.Global != nil && !h.Global.Allow() {
		h.reject(r, slog.LevelDebug, "global rate limit", http.StatusServiceUnavailable, "")
		fail(http.StatusServiceUnavailable)
		return "", false
	}
	if h.Paused != nil && h.Paused() {
		h.reject(r, slog.LevelDebug, "ingestion paused (database size)", http.StatusServiceUnavailable, "")
		fail(http.StatusServiceUnavailable)
		return "", false
	}
	return ip, true
}

// record stores ev and calls done, which writes the success response. An event over the
// per-visitor limit (checked when limitVisitor is set) is dropped but still answered with
// done, so a replaying script gets no signal. A full write queue calls fail with 503, a
// failed insert with 500.
func (h *Handler) record(r *http.Request, ev store.Event, limitVisitor bool, done func(), fail func(status int)) {
	if limitVisitor && h.VisitorLimiter != nil && !h.VisitorLimiter.Allow(ev.SiteID+":"+strconv.FormatInt(ev.VisitorID, 10)) {
		h.reject(r, slog.LevelDebug, "rate limit (visitor)", http.StatusAccepted, ev.SiteID)
		done()
		return
	}
	if h.WriteSlots != nil {
		t := time.NewTimer(writeWait)
		select {
		case h.WriteSlots <- struct{}{}:
			t.Stop()
			defer func() { <-h.WriteSlots }()
		case <-t.C:
			h.reject(r, slog.LevelDebug, "write queue full", http.StatusServiceUnavailable, ev.SiteID)
			fail(http.StatusServiceUnavailable)
			return
		case <-r.Context().Done():
			t.Stop()
			return
		}
	}
	if err := h.Store.InsertEvent(r.Context(), ev); err != nil {
		h.Log.Error("insert event", "err", err)
		fail(http.StatusInternalServerError)
		return
	}
	done()
}

func unavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "5")
	http.Error(w, "server busy", http.StatusServiceUnavailable)
}

// reject logs why an event was not stored. It records only coarse, non-identifying facts:
// the reason, the status sent, the Origin's hostname and the site id from the payload. Never
// the IP address or the user agent (see docs/privacy.md). Floods log at DEBUG, so they only
// show up with LOG_LEVEL=debug.
func (h *Handler) reject(r *http.Request, level slog.Level, reason string, status int, site string) {
	if h.Log == nil || !h.Log.Enabled(r.Context(), level) {
		return
	}
	attrs := []slog.Attr{slog.String("reason", reason), slog.Int("status", status)}
	if o := r.Header.Get("Origin"); o != "" {
		origin := o
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			origin = u.Hostname()
		}
		attrs = append(attrs, slog.String("origin", text.Truncate(text.Clean(origin), maxLogField)))
	}
	if site != "" {
		attrs = append(attrs, slog.String("site", text.Truncate(text.Clean(site), maxLogField)))
	}
	h.Log.LogAttrs(r.Context(), level, "event rejected", attrs...)
}

// maxLogField caps client-supplied text in log lines.
const maxLogField = 100

// badRequest is an error caused by the client's payload. The client sees public; reason is
// the specific cause, for the log only.
type badRequest struct{ public, reason string }

func (e badRequest) Error() string { return e.public }

// invalid is the deliberately vague answer for events that do not belong to a site, so a
// prober learns nothing about which check failed.
func invalid(reason string) badRequest { return badRequest{"invalid event", reason} }

// bad is a client error whose message is safe to show as is.
func bad(msg string) badRequest { return badRequest{msg, msg} }

func (h *Handler) buildEvent(ctx context.Context, r *http.Request, p Payload, ip, ua string, parsed useragent.UserAgent) (store.Event, error) {
	// Junk ids never reach the database or its negative cache.
	if !store.ValidSiteID(p.Site) {
		return store.Event{}, invalid("unknown site")
	}
	site, err := h.Store.GetSite(ctx, p.Site)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.Event{}, invalid("unknown site")
		}
		return store.Event{}, err
	}

	pageURL, err := url.Parse(p.URL)
	if err != nil || pageURL.Host == "" || (pageURL.Scheme != "http" && pageURL.Scheme != "https") {
		return store.Event{}, invalid("invalid page url")
	}
	host := normalizeHost(pageURL.Hostname())
	if !validHostname(host) || !hostMatches(host, site.Domain) {
		return store.Event{}, invalid("page url does not match the site's domain")
	}
	// Browsers always send Origin on POST, including sendBeacon. "null" (a sandboxed
	// iframe, a data: URL) is rejected: any page anywhere can create one, so it would let a
	// third party post events for every site from its visitors' browsers. This does not stop
	// a deliberate script, but it drops naive replays from curl and similar tools.
	origin := r.Header.Get("Origin")
	if origin == "" {
		return store.Event{}, invalid("missing origin")
	}
	if o, err := url.Parse(origin); err != nil || !hostMatches(normalizeHost(o.Hostname()), site.Domain) {
		return store.Event{}, invalid("origin does not match the site's domain")
	}

	ev := store.Event{
		SiteID:   site.ID,
		Time:     h.now(),
		Type:     "pageview",
		Hostname: host,
		Path:     text.Truncate(cleanPath(text.Clean(pagePath(pageURL))), maxPathLen),
		Browser:  parsed.Name,
		OS:       parsed.OS,
		Device:   deviceType(parsed),
	}

	switch p.Type {
	case "", "pageview":
	case "event":
		ev.Type = "event"
		ev.Name = text.Truncate(strings.TrimSpace(text.Clean(p.Name)), maxNameLen)
		if ev.Name == "" {
			return store.Event{}, bad("event name is required")
		}
	default:
		return store.Event{}, bad("unknown event type")
	}

	if p.Referrer != "" {
		if ref, err := url.Parse(p.Referrer); err == nil {
			ev.ReferrerHost = referrerHost(ref.Hostname(), site.Domain)
		}
	}

	q := pageURL.Query()
	ev.UTMSource = text.Truncate(strings.ToLower(text.Clean(q.Get("utm_source"))), maxPropValLen)
	ev.UTMMedium = text.Truncate(strings.ToLower(text.Clean(q.Get("utm_medium"))), maxPropValLen)
	ev.UTMCampaign = text.Truncate(text.Clean(q.Get("utm_campaign")), maxPropValLen)

	if ev.Props, err = parseProps(p.Props); err != nil {
		return store.Event{}, err
	}
	if ev.Type == "event" && ev.Name == outboundEvent {
		ev.Props[outboundURLProp] = stripURL(ev.Props[outboundURLProp])
	}

	ev.Country = h.Geo.Country(ip)
	if ev.VisitorID, err = h.Visitors.ID(ctx, site.ID, ip, ua); err != nil {
		return store.Event{}, err
	}
	return ev, nil
}

func (h *Handler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func parseProps(raw map[string]json.RawMessage) (map[string]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > maxProps {
		return nil, bad("too many props")
	}
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		k = text.Truncate(strings.TrimSpace(text.Clean(k)), maxPropKeyLen)
		if k == "" {
			continue
		}
		var val any
		if err := json.Unmarshal(v, &val); err != nil {
			return nil, bad("invalid prop value")
		}
		switch x := val.(type) {
		case string:
			out[k] = text.Truncate(text.Clean(x), maxPropValLen)
		case float64:
			out[k] = strconv.FormatFloat(x, 'f', -1, 64)
		case bool:
			out[k] = strconv.FormatBool(x)
		default:
			return nil, bad("prop values must be strings, numbers or booleans")
		}
	}
	return out, nil
}

func setCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

// The tracker's automatic outbound-link event carries the link target. Only its origin and
// path are kept: query strings, fragments and credentials in a link are not ours to store.
const (
	outboundEvent   = "outbound-link"
	outboundURLProp = "url"
)

func stripURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return (&url.URL{Scheme: u.Scheme, Host: u.Host, Path: u.Path}).String()
}

// pagePath is the stored path: the URL path, plus the fragment when it names a route in a
// hash-based router ("#/docs" or "#!/docs"). Other fragments (in-page anchors) are dropped,
// and so is a query string inside the route ("#/reset?token=…"), which can carry tokens.
func pagePath(u *url.URL) string {
	if f := u.Fragment; strings.HasPrefix(f, "/") || strings.HasPrefix(f, "!") {
		f, _, _ = strings.Cut(f, "?")
		return u.Path + "#" + f
	}
	return u.Path
}

// referrerHost is host as a stored referrer: normalised, a plausible public DNS name, and
// not the site itself (internal navigation is not a source). Otherwise "".
func referrerHost(host, domain string) string {
	host = normalizeHost(host)
	if !validHostname(host) || !strings.Contains(host, ".") || hostMatches(host, domain) {
		return ""
	}
	return host
}

func normalizeHost(h string) string {
	return strings.TrimPrefix(strings.TrimSuffix(strings.ToLower(h), "."), "www.")
}

// hostMatches reports whether host is domain or one of its subdomains.
func hostMatches(host, domain string) bool {
	return host == domain || strings.HasSuffix(host, "."+domain)
}

// validHostname reports whether h is a plausible DNS name: lowercase letters, digits,
// dots and hyphens, at most 253 characters. It rejects IP literals with ports, userinfo
// leftovers and anything that could carry markup into the dashboard.
func validHostname(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	for i := 0; i < len(h); i++ {
		c := h[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '.' && c != '-' {
			return false
		}
	}
	return true
}

func cleanPath(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

func deviceType(ua useragent.UserAgent) string {
	switch {
	case ua.Tablet:
		return "tablet"
	case ua.Mobile:
		return "mobile"
	case ua.Desktop:
		return "desktop"
	default:
		return "other"
	}
}

var botMarkers = []string{
	"bot", "crawl", "spider", "slurp", "headless", "lighthouse", "pingdom", "uptime", "phantomjs",
	"curl/", "wget/", "python-requests", "python-urllib", "aiohttp", "httpx", "go-http-client",
	"node-fetch", "axios/", "undici", "okhttp", "java/", "libwww", "scrapy", "postman",
	// Monitoring, benchmark and link-preview clients that don't say "bot".
	"gtmetrix", "check_http", "nagios", "site24x7", "statuscake", "apachebench", "whatsapp/",
}

func isBot(raw string, ua useragent.UserAgent) bool {
	if raw == "" || ua.Bot {
		return true
	}
	return hasBotMarker(strings.ToLower(raw))
}

// hasBotMarker reports whether a lowercased user agent contains one of botMarkers.
func hasBotMarker(l string) bool {
	for _, m := range botMarkers {
		if strings.Contains(l, m) {
			return true
		}
	}
	return false
}
