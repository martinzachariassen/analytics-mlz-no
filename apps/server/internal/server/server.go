// Package server wires HTTP routes.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/time/rate"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/api"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/ingest"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/script"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/visitor"
)

// New returns the root HTTP handler.
func New(cfg config.Config, st *store.Store, authn *auth.Service, loc *geo.Locator, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	events := &ingest.Handler{
		Store:    st,
		Visitors: visitor.NewHasher(st),
		Geo:      loc,
		// A real visitor sends a handful of events per page; bursts cover fast navigation.
		Limiter: httpx.NewRateLimiter(10, 30),
		// Behind a CDN the peer is an edge address shared by many visitors, so this is generous.
		// It only matters when a request bypasses a proxy and forges X-Forwarded-For.
		PeerLimiter: httpx.NewRateLimiter(50, 200),
		// One visitor (site + daily hash of IP and user agent): at most ~1 event/s sustained.
		VisitorLimiter: httpx.NewRateLimiter(1, 60),
		// SQLite has one writer; more concurrent inserts only queue on its lock.
		WriteSlots: make(chan struct{}, 32),
		ProxyHops:  cfg.ProxyHops,
		Log:        log,
	}
	if cfg.MaxDatabaseMB > 0 {
		g := &sizeGuard{size: st.Size, max: int64(cfg.MaxDatabaseMB) << 20, interval: 30 * time.Second, log: log}
		events.Paused = g.Paused
	}
	if cfg.IngestRate > 0 {
		events.Global = rate.NewLimiter(rate.Limit(cfg.IngestRate), 2*cfg.IngestRate)
	}
	mux.Handle("POST /api/event", events)
	mux.Handle("OPTIONS /api/event", events)
	mux.Handle("GET /api/pixel.gif", events.Pixel())
	mux.Handle("GET /api/script.js", script.Handler())

	// Sign-in endpoints are public; limit them per client so they can't be used to hammer
	// the OAuth provider or the session table.
	csrf := crossOrigin(cfg.PublicURL, log)
	authMux := http.NewServeMux()
	authn.Register(authMux)
	mux.Handle("/api/auth/", limit(httpx.NewRateLimiter(5, 30), httpx.NewRateLimiter(20, 100), cfg.ProxyHops, csrf.Handler(authMux)))

	(&api.API{Store: st, Log: log}).Register(mux, func(h http.Handler) http.Handler {
		return csrf.Handler(authn.Require(h))
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := st.Ping(ctx); err != nil {
			log.Error("health check failed", "err", err)
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "error": "database unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return secure(cfg, jsonErrors(mux))
}

// crossOrigin is the CSRF protection for the dashboard and sign-in routes. It rejects
// non-safe requests that a browser marks as cross-origin (Sec-Fetch-Site, or an Origin that
// differs from Host), whatever their content type or body. The dashboard origin is trusted
// explicitly because behind Firebase Hosting the Host header can be the Cloud Run address.
// POST /api/event, the pixel and the tracking script are cross-origin by design and are not wrapped.
func crossOrigin(publicURL string, log *slog.Logger) *http.CrossOriginProtection {
	c := http.NewCrossOriginProtection()
	if err := c.AddTrustedOrigin(publicURL); err != nil {
		// config.Load has already validated PUBLIC_URL as an origin.
		log.Error("PUBLIC_URL is not a valid origin for the CSRF check", "err", err)
	}
	c.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, http.StatusForbidden, "cross-origin request")
	}))
	return c
}

// secure adds the response headers every response gets, whether or not a CDN in front
// adds its own. The API serves JSON and a script, never HTML, so the policy is "nothing":
// no embedding, no scripts, no referrer. HSTS is sent when the dashboard is served over https.
func secure(cfg config.Config, next http.Handler) http.Handler {
	hsts := strings.HasPrefix(cfg.PublicURL, "https://")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Robots-Tag", "noindex, nofollow")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("X-Frame-Options", "DENY")
		if hsts {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// jsonErrors turns the mux's own text 404 and 405 responses into the API's JSON shape,
// keeping the Allow header the mux sets on a 405.
func jsonErrors(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := mux.Handler(r); pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}
		probe := &headerOnly{header: http.Header{}}
		mux.ServeHTTP(probe, r)
		if allow := probe.header.Get("Allow"); allow != "" {
			w.Header().Set("Allow", allow)
		}
		if probe.status == http.StatusMethodNotAllowed {
			httpx.Error(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		httpx.Error(w, http.StatusNotFound, "not found")
	})
}

// headerOnly records a response's status and headers and discards its body.
type headerOnly struct {
	header http.Header
	status int
}

func (h *headerOnly) Header() http.Header         { return h.header }
func (h *headerOnly) Write(b []byte) (int, error) { return len(b), nil }
func (h *headerOnly) WriteHeader(status int)      { h.status = status }

// limit rate limits by client IP and, separately, by the unforgeable upstream address, so a
// client that forges X-Forwarded-For on a direct connection still hits a ceiling.
func limit(client, peer *httpx.RateLimiter, proxyHops int, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := httpx.ClientIP(r, proxyHops)
		if p := httpx.PeerIP(r, proxyHops); p != ip && !peer.Allow(p) {
			httpx.Error(w, http.StatusTooManyRequests, "too many requests")
			return
		}
		if !client.Allow(ip) {
			httpx.Error(w, http.StatusTooManyRequests, "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}
