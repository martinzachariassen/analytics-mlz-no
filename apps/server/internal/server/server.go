// Package server wires HTTP routes.
package server

import (
	"context"
	"log/slog"
	"net/http"
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
	mux.Handle("GET /api/script.js", script.Handler())

	// Sign-in endpoints are public; limit them per client so they can't be used to hammer
	// the OAuth provider or the session table.
	authMux := http.NewServeMux()
	authn.Register(authMux)
	mux.Handle("/api/auth/", limit(httpx.NewRateLimiter(5, 30), cfg.ProxyHops, authMux))

	(&api.API{Store: st, Log: log}).Register(mux, authn.Require)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := st.Ping(ctx); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})

	return noIndex(mux)
}

// noIndex tells search engines not to index anything this server serves: the API, the tracking
// script and error pages. It does not stop browsers from loading the script.
func noIndex(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		next.ServeHTTP(w, r)
	})
}

func limit(rl *httpx.RateLimiter, proxyHops int, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.Allow(httpx.ClientIP(r, proxyHops)) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
