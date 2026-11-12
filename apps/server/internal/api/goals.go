package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

type goalJSON struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
}

func goalToJSON(g store.Goal) goalJSON {
	return goalJSON{ID: g.ID, Kind: g.Kind, Value: g.Value, CreatedAt: g.CreatedAt}
}

type goalRequest struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

func (a *API) listGoals(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	goals, err := a.Store.ListGoals(r.Context(), site.ID)
	if err != nil {
		a.internal(w, "list goals", err)
		return
	}
	out := make([]goalJSON, len(goals))
	for i, g := range goals {
		out[i] = goalToJSON(g)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (a *API) createGoal(w http.ResponseWriter, r *http.Request) {
	var req goalRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request")
		return
	}
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	g, err := a.Store.CreateGoal(r.Context(), site.ID, req.Kind, req.Value)
	switch {
	case errors.Is(err, store.ErrGoalExists):
		httpx.Error(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, store.ErrGoalInvalid), errors.Is(err, store.ErrGoalLimit):
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	case err != nil:
		a.internal(w, "create goal", err)
		return
	}
	a.audit(r, "goal created", "site", site.ID, "goal", g.ID, "kind", g.Kind, "value", g.Value)
	httpx.WriteJSON(w, http.StatusCreated, goalToJSON(g))
}

// deleteGoal has no body, so it checks the Origin instead of relying on the JSON
// Content-Type for CSRF protection.
func (a *API) deleteGoal(w http.ResponseWriter, r *http.Request) {
	if !auth.SameOrigin(r, a.PublicURL) {
		httpx.Error(w, http.StatusForbidden, "cross-origin request")
		return
	}
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("goalId"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "goal not found")
		return
	}
	err = a.Store.DeleteGoal(r.Context(), site.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		httpx.Error(w, http.StatusNotFound, "goal not found")
		return
	}
	if err != nil {
		a.internal(w, "delete goal", err)
		return
	}
	a.audit(r, "goal deleted", "site", site.ID, "goal", id)
	w.WriteHeader(http.StatusNoContent)
}

type goalStatsResponse struct {
	Period periodJSON `json:"period"`
	// Visitors in the period: the denominator of every conversion rate.
	Visitors         int64          `json:"visitors"`
	PreviousVisitors int64          `json:"previous_visitors"`
	Goals            []goalStatJSON `json:"goals"`
	Compare          *periodJSON    `json:"compare,omitempty"`
}

type goalStatJSON struct {
	goalJSON
	Visitors       int64   `json:"visitors"`
	Completions    int64   `json:"completions"`
	ConversionRate float64 `json:"conversion_rate"` // 0..1
	// The comparison period (default: the one immediately before), as for stats.
	PreviousVisitors       int64   `json:"previous_visitors"`
	PreviousConversionRate float64 `json:"previous_conversion_rate"`
}

func rate(n, of int64) float64 {
	if of == 0 {
		return 0
	}
	return float64(n) / float64(of)
}

// goalStats reports conversions for every goal of the site, for the same period, filter
// and compare parameters as stats.
func (a *API) goalStats(w http.ResponseWriter, r *http.Request) {
	site, ok := a.site(w, r)
	if !ok {
		return
	}
	q, ok := a.parseQuery(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	goals, err := a.Store.ListGoals(ctx, site.ID)
	if err != nil {
		a.internal(w, "list goals", err)
		return
	}
	cmp := q.comparison(q.compare)
	out := goalStatsResponse{Period: q.json(), Goals: make([]goalStatJSON, len(goals))}
	if q.compare != "" {
		pj := cmp.json()
		out.Compare = &pj
	}
	// Without goals there is nothing to divide, so skip both scans of the range.
	if len(goals) == 0 {
		httpx.WriteJSON(w, http.StatusOK, out)
		return
	}
	cur, err := a.Store.GoalStats(ctx, site.ID, q.rng(), q.filters, goals)
	if err != nil {
		a.internal(w, "goal stats", err)
		return
	}
	prev, err := a.Store.GoalStats(ctx, site.ID, cmp.rng(), q.filters, goals)
	if err != nil {
		a.internal(w, "previous goal stats", err)
		return
	}
	out.Visitors, out.PreviousVisitors = cur.Visitors, prev.Visitors
	for i, g := range cur.Goals {
		p := prev.Goals[i]
		out.Goals[i] = goalStatJSON{
			goalJSON: goalToJSON(g.Goal), Visitors: g.Visitors, Completions: g.Completions,
			ConversionRate:   rate(g.Visitors, cur.Visitors),
			PreviousVisitors: p.Visitors, PreviousConversionRate: rate(p.Visitors, prev.Visitors),
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
