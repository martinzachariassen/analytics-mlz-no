package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func setup(t *testing.T) (http.Handler, *http.Cookie) {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	// Create a signed-in session directly, bypassing OAuth (covered in package auth).
	u, err := st.LoginUser(ctx, "github", "1", "martin", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	token := "test-session-token"
	sum := sha256.Sum256([]byte(token))
	if err := st.CreateSession(ctx, sum[:], u.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	loc, _ := geo.Open("")
	authn := &auth.Service{Store: st, PublicURL: "http://localhost:8080", Log: log}
	h := New(config.Config{}, st, authn, loc, log)
	return h, &http.Cookie{Name: auth.CookieName, Value: token}
}

func call(h http.Handler, method, path, body string, c *http.Cookie, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c != nil {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestProtectedRoutesRequireSession(t *testing.T) {
	h, _ := setup(t)
	for _, path := range []string{"/api/sites", "/api/sites/x/stats", "/api/sites/x/breakdown?dim=path", "/api/auth/me"} {
		if w := call(h, "GET", path, "", nil, ""); w.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401", path, w.Code)
		}
	}
	bad := &http.Cookie{Name: auth.CookieName, Value: "forged"}
	if w := call(h, "GET", "/api/sites", "", bad, ""); w.Code != http.StatusUnauthorized {
		t.Errorf("forged cookie = %d, want 401", w.Code)
	}
}

func TestSitesCRUD(t *testing.T) {
	h, c := setup(t)
	const js = "application/json"

	w := call(h, "POST", "/api/sites", `{"name":"Blog","domain":"https://www.mlz.no/"}`, c, js)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", w.Code, w.Body)
	}
	var site struct{ ID, Name, Domain string }
	_ = json.Unmarshal(w.Body.Bytes(), &site)
	if site.Domain != "mlz.no" || site.ID == "" {
		t.Fatalf("site = %+v", site)
	}

	if w := call(h, "POST", "/api/sites", `{"domain":"mlz.no"}`, c, js); w.Code != http.StatusConflict {
		t.Fatalf("duplicate = %d, want 409", w.Code)
	}
	if w := call(h, "POST", "/api/sites", `{"domain":""}`, c, js); w.Code != http.StatusBadRequest {
		t.Fatalf("empty domain = %d, want 400", w.Code)
	}

	w = call(h, "PATCH", "/api/sites/"+site.ID, `{"name":"Renamed","domain":"mlz.no"}`, c, js)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "Renamed") {
		t.Fatalf("update = %d %s", w.Code, w.Body)
	}

	if w := call(h, "GET", "/api/sites", "", c, ""); !strings.Contains(w.Body.String(), site.ID) {
		t.Fatalf("list = %s", w.Body)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID+"/stats?from=2026-11-01&to=2026-11-03&tz=Europe/Oslo", "", c, ""); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"interval":"day"`) {
		t.Fatalf("stats = %d %s", w.Code, w.Body)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID+"/breakdown?dim=referrer", "", c, ""); w.Code != http.StatusOK || w.Body.String() != "[]\n" {
		t.Fatalf("breakdown = %d %q", w.Code, w.Body)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID+"/breakdown?dim=nope", "", c, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad dim = %d, want 400", w.Code)
	}

	if w := call(h, "DELETE", "/api/sites/"+site.ID, "", c, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", w.Code)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID, "", c, ""); w.Code != http.StatusNotFound {
		t.Fatalf("get deleted = %d, want 404", w.Code)
	}
}

func TestMutationsRequireJSON(t *testing.T) {
	h, c := setup(t)
	// A cross-site HTML form can only send form/text content types.
	for _, ct := range []string{"application/x-www-form-urlencoded", "text/plain", ""} {
		if w := call(h, "POST", "/api/sites", `{"domain":"evil.com"}`, c, ct); w.Code != http.StatusBadRequest {
			t.Errorf("content-type %q = %d, want 400", ct, w.Code)
		}
	}
}
