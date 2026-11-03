// Package api implements the authenticated dashboard API: sites and statistics.
package api

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/store"
)

// API serves the dashboard endpoints. All routes must be wrapped with auth.
type API struct {
	Store *store.Store
	Log   *slog.Logger
	Now   func() time.Time
}

// Register adds the routes to mux, wrapping each with protect.
func (a *API) Register(mux *http.ServeMux, protect func(http.Handler) http.Handler) {
	routes := map[string]http.HandlerFunc{
		"GET /api/sites":                a.listSites,
		"POST /api/sites":               a.createSite,
		"GET /api/sites/{id}":           a.getSite,
		"PATCH /api/sites/{id}":         a.updateSite,
		"DELETE /api/sites/{id}":        a.deleteSite,
		"GET /api/sites/{id}/stats":     a.stats,
		"GET /api/sites/{id}/breakdown": a.breakdown,
		"GET /api/sites/{id}/heatmap":   a.heatmap,
		"GET /api/sites/{id}/realtime":  a.realtime,
	}
	for pattern, h := range routes {
		mux.Handle(pattern, protect(h))
	}
}

type siteJSON struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Domain    string    `json:"domain"`
	CreatedAt time.Time `json:"created_at"`
}

func toJSON(s store.Site) siteJSON {
	return siteJSON{ID: s.ID, Name: s.Name, Domain: s.Domain, CreatedAt: s.CreatedAt}
}

type siteRequest struct {
	Name   string `json:"name"`
	Domain string `json:"domain"`
}

func (a *API) listSites(w http.ResponseWriter, r *http.Request) {
	sites, err := a.Store.ListSites(r.Context())
	if err != nil {
		a.internal(w, "list sites", err)
		return
	}
	out := make([]siteJSON, 0, len(sites))
	for _, s := range sites {
		out = append(out, toJSON(s))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (a *API) createSite(w http.ResponseWriter, r *http.Request) {
	var req siteRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request")
		return
	}
	site, err := a.Store.CreateSite(r.Context(), req.Name, req.Domain)
	if a.siteError(w, err) {
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toJSON(site))
}

func (a *API) getSite(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(site))
}

func (a *API) updateSite(w http.ResponseWriter, r *http.Request) {
	var req siteRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request")
		return
	}
	site, err := a.Store.UpdateSite(r.Context(), r.PathValue("id"), req.Name, req.Domain)
	if a.siteError(w, err) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(site))
}

func (a *API) deleteSite(w http.ResponseWriter, r *http.Request) {
	if a.siteError(w, a.Store.DeleteSite(r.Context(), r.PathValue("id"))) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// site loads the {id} path site, writing 404 if missing.
func (a *API) site(w http.ResponseWriter, r *http.Request) (store.Site, bool) {
	site, err := a.Store.GetSite(r.Context(), r.PathValue("id"))
	if a.siteError(w, err) {
		return store.Site{}, false
	}
	return site, true
}

// siteError maps store errors to responses. It returns true if a response was written.
func (a *API) siteError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "site not found")
	case errors.Is(err, store.ErrDomainTaken):
		httpx.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, store.ErrDomainRequired):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	default:
		a.internal(w, "site", err)
	}
	return true
}

func (a *API) internal(w http.ResponseWriter, op string, err error) {
	a.Log.Error(op, "err", err)
	httpx.Error(w, http.StatusInternalServerError, "internal error")
}

func (a *API) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}
