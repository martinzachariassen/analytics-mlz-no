package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func TestGoalStatsConversionAndComparison(t *testing.T) {
	day := func(d, m int) time.Time { return time.Date(2026, 11, d, 10, m, 0, 0, time.UTC) }
	// 2 November: four visitors, two sign up (one of them twice).
	// 1 November (the previous day): two visitors, one signs up.
	h, base := newTestAPI(t, day(3, 0), []store.Event{
		{Time: day(2, 0), VisitorID: 1, Path: "/", Country: "NO"},
		{Time: day(2, 1), VisitorID: 1, Type: "event", Name: "signup", Path: "/", Country: "NO"},
		{Time: day(2, 2), VisitorID: 1, Type: "event", Name: "signup", Path: "/", Country: "NO"},
		{Time: day(2, 0), VisitorID: 2, Path: "/pricing", Country: "SE"},
		{Time: day(2, 1), VisitorID: 2, Type: "event", Name: "signup", Path: "/pricing", Country: "SE"},
		{Time: day(2, 0), VisitorID: 3, Path: "/docs/a", Country: "SE"},
		{Time: day(2, 0), VisitorID: 4, Path: "/docs/b", Country: "NO"},
		{Time: day(1, 0), VisitorID: 5, Path: "/"},
		{Time: day(1, 1), VisitorID: 5, Type: "event", Name: "signup", Path: "/"},
		{Time: day(1, 0), VisitorID: 6, Path: "/docs/a"},
	})
	for _, body := range []string{`{"kind":"event","value":"signup"}`, `{"kind":"path","value":"/docs/*"}`} {
		req := httptest.NewRequest(http.MethodPost, base+"/goals", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("create %s = %d %s", body, w.Code, w.Body)
		}
	}

	type stats struct {
		V     int64 `json:"visitors"`
		PV    int64 `json:"previous_visitors"`
		Goals []struct {
			Kind, Value            string
			Visitors, Completions  int64
			ConversionRate         float64 `json:"conversion_rate"`
			PreviousVisitors       int64   `json:"previous_visitors"`
			PreviousConversionRate float64 `json:"previous_conversion_rate"`
		}
		Compare *periodJSON
	}
	s := get[stats](t, h, base+"/goals/stats?from=2026-11-02&to=2026-11-02")
	if s.V != 4 || s.PV != 2 || len(s.Goals) != 2 || s.Compare != nil {
		t.Fatalf("stats = %+v; want 4 visitors, 2 before, two goals, no compare", s)
	}
	signup, docs := s.Goals[0], s.Goals[1]
	if signup.Value != "signup" || signup.Visitors != 2 || signup.Completions != 3 || signup.ConversionRate != 0.5 ||
		signup.PreviousVisitors != 1 || signup.PreviousConversionRate != 0.5 {
		t.Fatalf("signup = %+v", signup)
	}
	if docs.Kind != "path" || docs.Visitors != 2 || docs.Completions != 2 || docs.ConversionRate != 0.5 ||
		docs.PreviousVisitors != 1 || docs.PreviousConversionRate != 0.5 {
		t.Fatalf("/docs/* = %+v", docs)
	}

	se := get[stats](t, h, base+"/goals/stats?from=2026-11-02&to=2026-11-02&f=country:is:SE&compare=year")
	if se.V != 2 || se.PV != 0 || se.Compare == nil || se.Compare.From != "2025-11-02" {
		t.Fatalf("SE vs last year = %+v", se)
	}
	if g := se.Goals[0]; g.Visitors != 1 || g.ConversionRate != 0.5 || g.PreviousConversionRate != 0 {
		t.Fatalf("SE signup = %+v; an empty comparison period must give 0, not NaN", g)
	}

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, base+"/goals/stats?f=nope:is:x", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad filter = %d, want 400", w.Code)
	}
}
