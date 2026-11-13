package ingest

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/mileusna/useragent"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/text"
)

// pixelGIF is a 1×1 transparent GIF.
var pixelGIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
	0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
	0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
}

// Pixel serves GET /api/pixel.gif, for pages that cannot run the tracking script (a GitHub
// README, an email). It shares the handler's limiters with POST /api/event.
//
// Every request is answered with the image, whether or not an event was stored, including
// requests over a rate limit and while ingestion is paused: a broken image would show on
// the page, and a prober learns nothing about which check failed. Only sites with the pixel
// enabled accept events, because a GET carries no Origin to check against the site's domain.
func (h *Handler) Pixel() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			writeGIF(w, r)
			return
		}
		fail := func(int) { writeGIF(w, r) }
		ip, ok := h.admit(r, fail)
		if !ok {
			return
		}
		ua := r.UserAgent()
		proxy, viaProxy := matchProxy(ua)
		parsedUA := useragent.Parse(ua)
		if !viaProxy && isBot(ua, parsedUA) {
			h.reject(r, slog.LevelDebug, "bot", http.StatusOK, "")
			writeGIF(w, r)
			return
		}

		q := r.URL.Query()
		ev, err := h.buildPixelEvent(r.Context(), q, r.Referer(), ip, ua, parsedUA, proxy, viaProxy)
		var br badRequest
		if errors.As(err, &br) {
			h.reject(r, slog.LevelInfo, br.reason, http.StatusOK, q.Get("site"))
			writeGIF(w, r)
			return
		}
		if err != nil {
			h.Log.Error("build pixel event", "err", err)
			writeGIF(w, r)
			return
		}
		// Every reader behind a proxy shares the proxy's visitor id, so the per-visitor
		// limit would cut real traffic; the address limits still apply.
		h.record(r, ev, !viaProxy, func() { writeGIF(w, r) }, fail)
	})
}

func writeGIF(w http.ResponseWriter, r *http.Request) {
	hd := w.Header()
	hd.Set("Content-Type", "image/gif")
	hd.Set("Content-Length", strconv.Itoa(len(pixelGIF)))
	// Image proxies and CDNs cache by default; each view must reach the server.
	hd.Set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
	hd.Set("Pragma", "no-cache")
	hd.Set("Expires", "0")
	hd.Set("Cross-Origin-Resource-Policy", "cross-origin")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(pixelGIF)
	}
}

func (h *Handler) buildPixelEvent(ctx context.Context, q url.Values, referer, ip, ua string, parsed useragent.UserAgent, proxy imageProxy, viaProxy bool) (store.Event, error) {
	id := q.Get("site")
	if !store.ValidSiteID(id) {
		return store.Event{}, invalid("unknown site")
	}
	site, err := h.Store.GetSite(ctx, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.Event{}, invalid("unknown site")
		}
		return store.Event{}, err
	}
	if !site.PixelEnabled {
		return store.Event{}, invalid("pixel disabled for site")
	}

	ev := store.Event{
		SiteID:   site.ID,
		Time:     h.now(),
		Type:     "pageview",
		Hostname: site.Domain,
		Path:     text.Truncate(pixelPath(q.Get("p")), maxPathLen),
	}
	if name := text.Truncate(strings.TrimSpace(text.Clean(q.Get("e"))), maxNameLen); name != "" {
		ev.Type, ev.Name = "event", name
	} else if q.Has("e") {
		return store.Event{}, bad("event name is required")
	}

	// The ref parameter wins. Otherwise a browser loading the image sends the embedding
	// page as Referer, which also shows a site owner where an unexpected copy of their pixel
	// is embedded. Behind a proxy the Referer describes the proxy, so the proxy's site is used.
	ev.ReferrerHost = referrerHost(strings.TrimSpace(q.Get("ref")), site.Domain)
	if ev.ReferrerHost == "" {
		if viaProxy {
			ev.ReferrerHost = proxy.source
		} else if u, err := url.Parse(referer); err == nil {
			ev.ReferrerHost = referrerHost(u.Hostname(), site.Domain)
		}
	}
	ev.UTMSource = text.Truncate(strings.ToLower(text.Clean(q.Get("utm_source"))), maxPropValLen)
	ev.UTMMedium = text.Truncate(strings.ToLower(text.Clean(q.Get("utm_medium"))), maxPropValLen)
	ev.UTMCampaign = text.Truncate(text.Clean(q.Get("utm_campaign")), maxPropValLen)

	// Behind a proxy, the address and user agent are the proxy's: country, browser, OS and
	// device would describe it, not the reader, so they stay empty.
	if !viaProxy {
		ev.Browser, ev.OS, ev.Device = parsed.Name, parsed.OS, deviceType(parsed)
		ev.Country = h.Geo.Country(ip)
	}
	if ev.VisitorID, err = h.Visitors.ID(ctx, site.ID, ip, ua); err != nil {
		return store.Event{}, err
	}
	return ev, nil
}

// pixelPath is the p parameter as a stored path: query string and fragment dropped, a
// leading slash added, "/" when empty.
func pixelPath(p string) string {
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	p = strings.TrimSpace(text.Clean(p))
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}
