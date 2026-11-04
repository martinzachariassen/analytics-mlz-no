// Package ingest implements the public event collection endpoint (POST /api/event).
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
	"unicode"
	"unicode/utf8"

	"github.com/mileusna/useragent"
	"golang.org/x/time/rate"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
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

// Handler serves POST /api/event.
//
// Abuse protection, in request order (every limiter is optional):
//   - Limiter: per client IP. Rejected with 429.
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

	ip := httpx.ClientIP(r, h.ProxyHops)
	if h.Limiter != nil && !h.Limiter.Allow(ip) {
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return
	}
	if h.PeerLimiter != nil {
		if peer := httpx.PeerIP(r, h.ProxyHops); peer != ip && !h.PeerLimiter.Allow(peer) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
	}
	if h.Global != nil && !h.Global.Allow() {
		unavailable(w)
		return
	}
	if h.Paused != nil && h.Paused() {
		unavailable(w)
		return
	}

	ua := r.UserAgent()
	parsedUA := useragent.Parse(ua)
	if isBot(ua, parsedUA) {
		// Accept silently so bots get no signal, but don't store anything.
		w.WriteHeader(http.StatusAccepted)
		return
	}

	// sendBeacon uses text/plain to avoid a CORS preflight, so accept any content type.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	var p Payload
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	ev, err := h.buildEvent(r.Context(), r, p, ip, ua, parsedUA)
	var bad badRequest
	if errors.As(err, &bad) {
		http.Error(w, bad.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		h.Log.Error("build event", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if h.VisitorLimiter != nil && !h.VisitorLimiter.Allow(ev.SiteID+":"+strconv.FormatInt(ev.VisitorID, 10)) {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	if h.WriteSlots != nil {
		t := time.NewTimer(writeWait)
		select {
		case h.WriteSlots <- struct{}{}:
			t.Stop()
			defer func() { <-h.WriteSlots }()
		case <-t.C:
			unavailable(w)
			return
		case <-r.Context().Done():
			t.Stop()
			return
		}
	}
	if err := h.Store.InsertEvent(r.Context(), ev); err != nil {
		h.Log.Error("insert event", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func unavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "5")
	http.Error(w, "server busy", http.StatusServiceUnavailable)
}

// badRequest is an error caused by the client's payload.
type badRequest string

func (e badRequest) Error() string { return string(e) }

const errInvalid = badRequest("invalid event")

func (h *Handler) buildEvent(ctx context.Context, r *http.Request, p Payload, ip, ua string, parsed useragent.UserAgent) (store.Event, error) {
	site, err := h.Store.GetSite(ctx, p.Site)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.Event{}, errInvalid
		}
		return store.Event{}, err
	}

	pageURL, err := url.Parse(p.URL)
	if err != nil || pageURL.Host == "" {
		return store.Event{}, errInvalid
	}
	host := normalizeHost(pageURL.Hostname())
	if !validHostname(host) || !hostMatches(host, site.Domain) {
		return store.Event{}, errInvalid
	}
	// Browsers always send Origin on POST, including sendBeacon. "null" comes from
	// sandboxed or privacy-restricted contexts and is allowed. This does not stop a
	// deliberate script, but it drops naive replays from curl and similar tools.
	switch origin := r.Header.Get("Origin"); origin {
	case "":
		return store.Event{}, errInvalid
	case "null":
	default:
		o, err := url.Parse(origin)
		if err != nil || !hostMatches(normalizeHost(o.Hostname()), site.Domain) {
			return store.Event{}, errInvalid
		}
	}

	ev := store.Event{
		SiteID:   site.ID,
		Time:     h.now(),
		Type:     "pageview",
		Hostname: host,
		Path:     truncate(cleanPath(cleanText(pageURL.Path)), maxPathLen),
		Browser:  parsed.Name,
		OS:       parsed.OS,
		Device:   deviceType(parsed),
	}

	switch p.Type {
	case "", "pageview":
	case "event":
		ev.Type = "event"
		ev.Name = truncate(strings.TrimSpace(cleanText(p.Name)), maxNameLen)
		if ev.Name == "" {
			return store.Event{}, badRequest("event name is required")
		}
	default:
		return store.Event{}, badRequest("unknown event type")
	}

	if p.Referrer != "" {
		if ref, err := url.Parse(p.Referrer); err == nil {
			refHost := normalizeHost(ref.Hostname())
			if validHostname(refHost) && strings.Contains(refHost, ".") && !hostMatches(refHost, site.Domain) {
				ev.ReferrerHost = refHost
			}
		}
	}

	q := pageURL.Query()
	ev.UTMSource = truncate(strings.ToLower(cleanText(q.Get("utm_source"))), maxPropValLen)
	ev.UTMMedium = truncate(strings.ToLower(cleanText(q.Get("utm_medium"))), maxPropValLen)
	ev.UTMCampaign = truncate(cleanText(q.Get("utm_campaign")), maxPropValLen)

	if ev.Props, err = parseProps(p.Props); err != nil {
		return store.Event{}, err
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
		return nil, badRequest("too many props")
	}
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		k = truncate(strings.TrimSpace(cleanText(k)), maxPropKeyLen)
		if k == "" {
			continue
		}
		var val any
		if err := json.Unmarshal(v, &val); err != nil {
			return nil, badRequest("invalid prop value")
		}
		switch x := val.(type) {
		case string:
			out[k] = truncate(cleanText(x), maxPropValLen)
		case float64:
			out[k] = strconv.FormatFloat(x, 'f', -1, 64)
		case bool:
			out[k] = strconv.FormatBool(x)
		default:
			return nil, badRequest("prop values must be strings, numbers or booleans")
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

// cleanText drops invalid UTF-8, control characters (newlines, NUL, escapes) and bidi
// overrides, so stored strings are safe to log and cannot reorder text in the dashboard.
// Zero-width joiners stay, since emoji sequences use them.
func cleanText(s string) string {
	s = strings.ToValidUTF8(s, "")
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) {
			return -1
		}
		return r
	}, s)
}

func cleanPath(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
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
	l := strings.ToLower(raw)
	for _, m := range botMarkers {
		if strings.Contains(l, m) {
			return true
		}
	}
	return false
}
