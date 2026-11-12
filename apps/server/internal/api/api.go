// Package api implements the authenticated dashboard API: sites and statistics.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// queryTimeout bounds a single statistics request. The HTTP write timeout does not cancel
// the request context, so without this a slow query would keep running after the client gave up.
const queryTimeout = 10 * time.Second

// API serves the dashboard endpoints. All routes must be wrapped with auth.
//
// Every signed-in user can read and change every site: the dashboard is single-tenant,
// meant for one person or one team that trusts each other. Changes are logged with the user.
type API struct {
	Store *store.Store
	Log   *slog.Logger
	Now   func() time.Time
}

// Register adds the routes to mux, wrapping each with protect, which must authenticate the
// user and reject cross-origin requests (CSRF).
func (a *API) Register(mux *http.ServeMux, protect func(http.Handler) http.Handler) {
	routes := map[string]http.HandlerFunc{
		"GET /api/sites":                a.listSites,
		"POST /api/sites":               a.createSite,
		"GET /api/sites/{id}":           a.getSite,
		"PATCH /api/sites/{id}":         a.updateSite,
		"DELETE /api/sites/{id}":        a.deleteSite,
		"GET /api/sites/{id}/stats":     a.timed(a.stats),
		"GET /api/sites/{id}/breakdown": a.timed(a.breakdown),
		"GET /api/sites/{id}/heatmap":   a.timed(a.heatmap),
		"GET /api/sites/{id}/realtime":  a.timed(a.realtime),
		"GET /api/sites/{id}/export":    a.timed(a.export),
		"POST /api/sites/{id}/purge":    a.purge,

		"GET /api/sites/{id}/goals":             a.listGoals,
		"POST /api/sites/{id}/goals":            a.createGoal,
		"DELETE /api/sites/{id}/goals/{goalId}": a.deleteGoal,
		"GET /api/sites/{id}/goals/stats":       a.timed(a.goalStats),
	}
	for pattern, h := range routes {
		mux.Handle(pattern, protect(h))
	}
}

func (a *API) timed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
		defer cancel()
		h(w, r.WithContext(ctx))
	}
}

type siteJSON struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Domain    string    `json:"domain"`
	CreatedAt time.Time `json:"created_at"`
	// The oldest and newest stored events, null until the first one arrives. The
	// dashboard shows onboarding instead of empty charts while first_event_at is null.
	FirstEventAt *time.Time `json:"first_event_at"`
	LastEventAt  *time.Time `json:"last_event_at"`
}

func toJSON(s store.Site, act store.Activity) siteJSON {
	out := siteJSON{ID: s.ID, Name: s.Name, Domain: s.Domain, CreatedAt: s.CreatedAt}
	if !act.FirstEvent.IsZero() {
		out.FirstEventAt, out.LastEventAt = &act.FirstEvent, &act.LastEvent
	}
	return out
}

// withActivity is toJSON for a response that includes the site's event span.
func (a *API) withActivity(ctx context.Context, s store.Site) (siteJSON, error) {
	act, err := a.Store.SiteActivity(ctx, s.ID)
	return toJSON(s, act), err
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
	act, err := a.Store.AllSiteActivity(r.Context())
	if err != nil {
		a.internal(w, "list sites", err)
		return
	}
	out := make([]siteJSON, 0, len(sites))
	for _, s := range sites {
		out = append(out, toJSON(s, act[s.ID]))
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
	a.audit(r, "site created", "site", site.ID, "domain", site.Domain)
	httpx.WriteJSON(w, http.StatusCreated, toJSON(site, store.Activity{}))
}

func (a *API) getSite(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	j, err := a.withActivity(r.Context(), site)
	if err != nil {
		a.internal(w, "get site", err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, j)
}

// updateSite changes the fields that are present: an absent or empty domain keeps the
// current one, an absent or empty name defaults to the domain.
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
	a.audit(r, "site updated", "site", site.ID, "domain", site.Domain)
	// The update is stored; failing to read the event span must not report it as failed.
	j, err := a.withActivity(r.Context(), site)
	if err != nil {
		a.Log.Error("read site activity", "site", site.ID, "err", err)
		j = toJSON(site, store.Activity{})
	}
	httpx.WriteJSON(w, http.StatusOK, j)
}

func (a *API) deleteSite(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if a.siteError(w, a.Store.DeleteSite(r.Context(), id)) {
		return
	}
	a.audit(r, "site deleted", "site", id)
	w.WriteHeader(http.StatusNoContent)
}

type purgeRequest struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	Path string    `json:"path"`
}

// purge deletes a site's events in [from, to), optionally for one path. It is how spam is
// removed on hosts without a shell (Cloud Run); `analytics events purge` does the same locally.
func (a *API) purge(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	var req purgeRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil || req.From.IsZero() || !req.From.Before(req.To) {
		httpx.Error(w, http.StatusBadRequest, "from and to (RFC 3339) are required, and from must be before to")
		return
	}
	n, err := a.Store.PurgeEvents(r.Context(), store.PurgeFilter{SiteID: site.ID, From: req.From, To: req.To, Path: req.Path})
	if err != nil {
		a.internal(w, "purge events", err)
		return
	}
	a.audit(r, "purged events", "site", site.ID, "from", req.From, "to", req.To, "path", req.Path, "deleted", n)
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"deleted": n})
}

// audit logs a change together with who made it.
func (a *API) audit(r *http.Request, msg string, attrs ...any) {
	u, _ := auth.UserFrom(r.Context())
	a.Log.Info(msg, append([]any{"user", u.Login}, attrs...)...)
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
	case errors.Is(err, store.ErrDomainRequired), errors.Is(err, store.ErrDomainInvalid):
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
