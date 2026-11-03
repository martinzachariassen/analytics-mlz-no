// Package server wires HTTP routes.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/server/internal/api"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/ingest"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/store"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/tracker"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/visitor"
)

// New returns the root HTTP handler.
func New(cfg config.Config, st *store.Store, authn *auth.Service, loc *geo.Locator, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	events := &ingest.Handler{
		Store:     st,
		Visitors:  visitor.NewHasher(st),
		Geo:       loc,
		Limiter:   httpx.NewRateLimiter(10, 30),
		ProxyHops: cfg.ProxyHops,
		Log:       log,
	}
	mux.Handle("POST /api/event", events)
	mux.Handle("OPTIONS /api/event", events)
	mux.Handle("GET /api/script.js", tracker.Handler())

	authn.Register(mux)

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

	return mux
}
