package api

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// brokenAPI serves the API on a store from which the named tables have been dropped, so a
// handler's own lookups succeed while the query it is about to run fails.
func brokenAPI(t *testing.T, drop ...string) (h http.Handler, site string) {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "broken.db")
	st, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	s, err := st.CreateSite(ctx, "", "mlz.no")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateGoal(ctx, s.ID, "event", "signup"); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = raw.Close() }()
	for _, table := range drop {
		if _, err := raw.ExecContext(ctx, "DROP TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	a := &API{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time {
		return time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	}}
	a.Register(mux, func(h http.Handler) http.Handler { return h })
	return mux, "/api/sites/" + s.ID
}

type call struct {
	method, path, body string
}

func expectInternalError(t *testing.T, h http.Handler, calls []call) {
	t.Helper()
	for _, c := range calls {
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		if c.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusInternalServerError {
			t.Errorf("%s %s = %d %s, want 500", c.method, c.path, w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), "no such table") {
			t.Errorf("%s %s leaks the database error: %s", c.method, c.path, w.Body)
		}
	}
}

func TestStatsEndpointsAnswer500WhenEventsCannotBeRead(t *testing.T) {
	h, base := brokenAPI(t, "events")
	const rng = "?from=2026-11-02&to=2026-11-03&tz=UTC"
	expectInternalError(t, h, []call{
		{http.MethodGet, "/api/sites", ""},
		{http.MethodGet, base, ""},
		{http.MethodGet, base + "/stats" + rng, ""},
		{http.MethodGet, base + "/stats" + rng + "&compare=previous", ""},
		{http.MethodGet, base + "/breakdown" + rng + "&dim=path", ""},
		{http.MethodGet, base + "/breakdown" + rng + "&dim=path&metrics=full", ""},
		{http.MethodGet, base + "/heatmap" + rng, ""},
		{http.MethodGet, base + "/realtime", ""},
		{http.MethodGet, base + "/realtime?detail=1", ""},
		{http.MethodGet, base + "/export" + rng + "&what=breakdown&dim=path", ""},
		{http.MethodGet, base + "/export" + rng + "&what=timeseries", ""},
		{http.MethodGet, base + "/goals/stats" + rng, ""},
		{http.MethodPost, base + "/purge", `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}`},
	})
}

func TestGoalEndpointsAnswer500WhenGoalsCannotBeRead(t *testing.T) {
	h, base := brokenAPI(t, "goals")
	expectInternalError(t, h, []call{
		{http.MethodGet, base + "/goals", ""},
		{http.MethodPost, base + "/goals", `{"kind":"event","value":"signup"}`},
		{http.MethodDelete, base + "/goals/1", ""},
		{http.MethodGet, base + "/goals/stats?from=2026-11-02&to=2026-11-03", ""},
	})
}

func TestSiteEndpointsAnswer500WhenSitesCannotBeRead(t *testing.T) {
	h, base := brokenAPI(t, "sites")
	expectInternalError(t, h, []call{
		{http.MethodGet, "/api/sites", ""},
		{http.MethodPost, "/api/sites", `{"domain":"example.com"}`},
		{http.MethodGet, base, ""},
		{http.MethodPatch, base, `{"pixel_enabled":true}`},
		{http.MethodDelete, base, ""},
		{http.MethodGet, base + "/stats?from=2026-11-02", ""},
		{http.MethodGet, base + "/goals", ""},
		{http.MethodPost, base + "/purge", `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}`},
	})
}
