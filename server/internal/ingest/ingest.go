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
	"unicode/utf8"

	"github.com/mileusna/useragent"

	"github.com/martinzachariassen/analytics-mlz-no/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/store"
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
type Handler struct {
	Store     Store
	Visitors  VisitorHasher
	Geo       *geo.Locator
	Limiter   *httpx.RateLimiter
	ProxyHops int
	Log       *slog.Logger
	Now       func() time.Time
}

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
	if err := h.Store.InsertEvent(r.Context(), ev); err != nil {
		h.Log.Error("insert event", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
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
	if !hostMatches(host, site.Domain) {
		return store.Event{}, errInvalid
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "null" {
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
		Path:     truncate(cleanPath(pageURL.Path), maxPathLen),
		Browser:  parsed.Name,
		OS:       parsed.OS,
		Device:   deviceType(parsed),
	}

	switch p.Type {
	case "", "pageview":
	case "event":
		ev.Type = "event"
		ev.Name = truncate(strings.TrimSpace(p.Name), maxNameLen)
		if ev.Name == "" {
			return store.Event{}, badRequest("event name is required")
		}
	default:
		return store.Event{}, badRequest("unknown event type")
	}

	if p.Referrer != "" {
		if ref, err := url.Parse(p.Referrer); err == nil {
			refHost := normalizeHost(ref.Hostname())
			if refHost != "" && !hostMatches(refHost, site.Domain) {
				ev.ReferrerHost = refHost
			}
		}
	}

	q := pageURL.Query()
	ev.UTMSource = truncate(strings.ToLower(q.Get("utm_source")), maxPropValLen)
	ev.UTMMedium = truncate(strings.ToLower(q.Get("utm_medium")), maxPropValLen)
	ev.UTMCampaign = truncate(q.Get("utm_campaign"), maxPropValLen)

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
		k = truncate(strings.TrimSpace(k), maxPropKeyLen)
		if k == "" {
			continue
		}
		var val any
		if err := json.Unmarshal(v, &val); err != nil {
			return nil, badRequest("invalid prop value")
		}
		switch x := val.(type) {
		case string:
			out[k] = truncate(x, maxPropValLen)
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

var botMarkers = []string{"bot", "crawl", "spider", "slurp", "headless", "lighthouse", "pingdom", "uptime", "curl/", "wget/", "python-requests", "go-http-client"}

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
