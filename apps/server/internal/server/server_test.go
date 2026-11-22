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
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

const publicURL = "https://stats.example.com"

func setup(t *testing.T) (http.Handler, *http.Cookie) {
	t.Helper()
	h, c, _ := setupWithStore(t)
	return h, c
}

func setupWithStore(t *testing.T) (http.Handler, *http.Cookie, *store.Store) {
	t.Helper()
	return setupWithConfig(t, config.Config{PublicURL: publicURL})
}

func setupWithConfig(t *testing.T, cfg config.Config) (http.Handler, *http.Cookie, *store.Store) {
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
	if err := st.CreateSession(ctx, sum[:], u.ID, time.Now(), time.Now().Add(auth.SessionTTL)); err != nil {
		t.Fatal(err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	loc, _ := geo.Open("")
	authn := &auth.Service{Store: st, PublicURL: publicURL, Allowed: []string{"martin"}, Log: log}
	h := New(cfg, st, authn, loc, log)
	return h, &http.Cookie{Name: auth.CookieName, Value: token}, st
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
	if w := call(h, "POST", "/api/sites", `{"domain":"no"}`, c, js); w.Code != http.StatusBadRequest {
		t.Fatalf("bare TLD = %d, want 400", w.Code)
	}

	w = call(h, "PATCH", "/api/sites/"+site.ID, `{"name":"Renamed"}`, c, js)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "Renamed") || !strings.Contains(w.Body.String(), `"domain":"mlz.no"`) {
		t.Fatalf("rename only = %d %s", w.Code, w.Body)
	}
	w = call(h, "PATCH", "/api/sites/"+site.ID, `{"domain":"blog.mlz.no"}`, c, js)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"domain":"blog.mlz.no"`) {
		t.Fatalf("change domain = %d %s", w.Code, w.Body)
	}
	if w := call(h, "PATCH", "/api/sites/nope", `{"name":"x"}`, c, js); w.Code != http.StatusNotFound {
		t.Fatalf("update unknown = %d, want 404", w.Code)
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

	purge := `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z","path":"/spam"}`
	if w := call(h, "POST", "/api/sites/"+site.ID+"/purge", purge, c, js); w.Code != http.StatusOK || w.Body.String() != `{"deleted":0}`+"\n" {
		t.Fatalf("purge = %d %q", w.Code, w.Body)
	}
	if w := call(h, "POST", "/api/sites/"+site.ID+"/purge", `{"from":"2026-11-02T00:00:00Z","to":"2026-11-01T00:00:00Z"}`, c, js); w.Code != http.StatusBadRequest {
		t.Fatalf("reversed purge = %d, want 400", w.Code)
	}
	if w := call(h, "POST", "/api/sites/"+site.ID+"/purge", purge, nil, js); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous purge = %d, want 401", w.Code)
	}

	if w := call(h, "DELETE", "/api/sites/"+site.ID, "", c, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", w.Code)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID, "", c, ""); w.Code != http.StatusNotFound {
		t.Fatalf("get deleted = %d, want 404", w.Code)
	}
}

func TestDeleteRejectsCrossOrigin(t *testing.T) {
	h, c := setup(t)
	w := call(h, "POST", "/api/sites", `{"domain":"mlz.no"}`, c, "application/json")
	var site struct{ ID string }
	_ = json.Unmarshal(w.Body.Bytes(), &site)

	req := httptest.NewRequest(http.MethodDelete, "/api/sites/"+site.ID, nil)
	req.AddCookie(c)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin delete = %d, want 403", rec.Code)
	}
	if w := call(h, "GET", "/api/sites/"+site.ID, "", c, ""); w.Code != http.StatusOK {
		t.Fatalf("site was deleted by a cross-origin request")
	}
}

func TestStatsEndpoints(t *testing.T) {
	h, c, st := setupWithStore(t)
	ctx := context.Background()
	site, _ := st.CreateSite(ctx, "", "mlz.no")
	now := time.Now().UTC()
	for i, path := range []string{"/", "/a", "/a", "/b"} {
		if err := st.InsertEvent(ctx, store.Event{SiteID: site.ID, Time: now.Add(-time.Duration(i) * time.Minute), Type: "pageview",
			Hostname: "mlz.no", Path: path, Country: "NO", VisitorID: int64(i % 2)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.InsertEvent(ctx, store.Event{SiteID: site.ID, Time: now, Type: "event", Name: "signup", Hostname: "mlz.no", Path: "/",
		VisitorID: 1, Props: map[string]string{"plan": "pro"}}); err != nil {
		t.Fatal(err)
	}
	today := now.Format(time.DateOnly)
	base := "/api/sites/" + site.ID

	ok := map[string]string{
		"realtime":          base + "/realtime",
		"realtime detail":   base + "/realtime?detail=1",
		"heatmap":           base + "/heatmap?from=" + today,
		"breakdown full":    base + "/breakdown?dim=path&metrics=full&from=" + today,
		"breakdown compare": base + "/breakdown?dim=path&compare=previous&from=" + today,
		"breakdown prop":    base + "/breakdown?dim=prop&event=signup&key=plan&from=" + today,
		"breakdown propkey": base + "/breakdown?dim=prop_key&event=signup&from=" + today,
		"breakdown limit":   base + "/breakdown?dim=path&limit=1&from=" + today,
		"stats filtered":    base + "/stats?from=" + today + "&f=country:is:NO&compare=year",
	}
	for name, path := range ok {
		if w := call(h, "GET", path, "", c, ""); w.Code != http.StatusOK {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	w := call(h, "GET", base+"/realtime?detail=1", "", c, "")
	var rt struct {
		Visitors int
		Pages    []struct{ Value string }
	}
	_ = json.Unmarshal(w.Body.Bytes(), &rt)
	if rt.Visitors != 2 || len(rt.Pages) == 0 {
		t.Fatalf("realtime = %s", w.Body)
	}
	w = call(h, "GET", base+"/breakdown?dim=path&limit=1&from="+today, "", c, "")
	var rows []struct{ Value string }
	_ = json.Unmarshal(w.Body.Bytes(), &rows)
	if len(rows) != 1 {
		t.Fatalf("limit=1 returned %d rows", len(rows))
	}

	bad := map[string]string{
		"bad tz":          base + "/stats?tz=Mars/Olympus",
		"bad interval":    base + "/stats?interval=fortnight",
		"hourly too long": base + "/stats?interval=hour&from=2026-01-01&to=2026-02-01",
		"range too long":  base + "/stats?from=2010-01-01&to=2026-01-01",
		"bad compare":     base + "/stats?compare=decade",
		"limit too big":   base + "/breakdown?dim=path&limit=100000",
		"limit zero":      base + "/breakdown?dim=path&limit=0",
		"prop w/o key":    base + "/breakdown?dim=prop&event=signup",
		"prop_key w/o ev": base + "/breakdown?dim=prop_key",
		"bad metrics":     base + "/breakdown?dim=path&metrics=some",
		"bad filter":      base + "/stats?f=country",
		"bad filter dim":  base + "/stats?f=password:is:x",
		"too many filter": base + "/stats?" + strings.Repeat("f=path:is:/x&", 11),
		"bad to":          base + "/stats?from=2026-11-01&to=03.11.2026",
		"daily too long":  base + "/stats?interval=day&from=2025-01-01&to=2026-02-05",
		"heatmap bad tz":  base + "/heatmap?tz=Mars/Olympus",
		"heatmap filter":  base + "/heatmap?f=password:is:x",
		"goals bad tz":    base + "/goals/stats?tz=Mars/Olympus",
		"goals compare":   base + "/goals/stats?compare=decade",
	}
	for name, path := range bad {
		if w := call(h, "GET", path, "", c, ""); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400 (%s)", name, w.Code, w.Body)
		}
	}
	for _, path := range []string{"/stats", "/breakdown?dim=path", "/heatmap", "/realtime", "/export?what=timeseries", "/goals", "/goals/stats", ""} {
		if w := call(h, "GET", "/api/sites/unknownsite"+path, "", c, ""); w.Code != http.StatusNotFound {
			t.Errorf("unknown site %q = %d, want 404", path, w.Code)
		}
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

func TestAuthRateLimited(t *testing.T) {
	h, _ := setup(t)
	var last *httptest.ResponseRecorder
	for i := 0; i < 50; i++ {
		last = call(h, http.MethodGet, "/api/auth/config", "", nil, "")
	}
	if last.Code != http.StatusTooManyRequests || !strings.Contains(last.Body.String(), `"error"`) {
		t.Fatalf("status = %d %s, want a JSON 429 after a burst", last.Code, last.Body)
	}
}

func TestAuthRateLimitCannotBeForged(t *testing.T) {
	// With PROXY_HOPS the client limiter keys on a header; the peer limiter still catches
	// a single connection that rotates forged addresses.
	loc, _ := geo.Open("")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	st, _ := store.Open(context.Background(), filepath.Join(t.TempDir(), "x.db"))
	t.Cleanup(func() { _ = st.Close() })
	h := New(config.Config{PublicURL: publicURL, ProxyHops: 2}, st, &auth.Service{Store: st, PublicURL: publicURL, Log: log}, loc, log)
	var last int
	for i := 0; i < 300; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/config", nil)
		req.Header.Set("X-Forwarded-For", "10.0."+strconv.Itoa(i/250)+"."+strconv.Itoa(i%250)+", 198.51.100.7")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		last = w.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 from the peer limit", last)
	}
}

func TestSecurityHeaders(t *testing.T) {
	h, c := setup(t)
	// A 404 under /api: outside it, a build with the dashboard embedded answers with its own headers.
	for _, path := range []string{"/api/script.js", "/api/auth/me", "/healthz", "/api/does-not-exist", "/api/sites"} {
		hdr := call(h, "GET", path, "", c, "").Header()
		want := map[string]string{
			"X-Robots-Tag":              "noindex, nofollow",
			"X-Content-Type-Options":    "nosniff",
			"Referrer-Policy":           "no-referrer",
			"X-Frame-Options":           "DENY",
			"Content-Security-Policy":   "default-src 'none'; frame-ancestors 'none'",
			"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		}
		for k, v := range want {
			if got := hdr.Get(k); got != v {
				t.Errorf("GET %s: %s = %q, want %q", path, k, got, v)
			}
		}
	}
	// No HSTS for a plain-http (local) PUBLIC_URL.
	loc, _ := geo.Open("")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	st, _ := store.Open(context.Background(), filepath.Join(t.TempDir(), "x.db"))
	t.Cleanup(func() { _ = st.Close() })
	local := New(config.Config{PublicURL: "http://localhost:8080"}, st, &auth.Service{Store: st, PublicURL: "http://localhost:8080", Log: log}, loc, log)
	if got := call(local, "GET", "/healthz", "", nil, "").Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("HSTS on http: %q", got)
	}
}

func TestErrorsAreJSON(t *testing.T) {
	h, _ := setup(t)
	// Under /api, so the answer is the same whether or not the dashboard is embedded.
	w := call(h, "GET", "/api/nope", "", nil, "")
	if w.Code != http.StatusNotFound || w.Header().Get("Content-Type") != "application/json" || !strings.Contains(w.Body.String(), `"not found"`) {
		t.Fatalf("404 = %d %q %q", w.Code, w.Header().Get("Content-Type"), w.Body)
	}
	w = call(h, "GET", "/api/event", "", nil, "")
	if w.Code != http.StatusMethodNotAllowed || !strings.Contains(w.Header().Get("Allow"), "POST") || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("405 = %d allow=%q %q", w.Code, w.Header().Get("Allow"), w.Body)
	}
}

func TestDashboardFallback(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/event", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	dashboard := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := fallback(mux, dashboard)
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/", http.StatusTeapot},
		{"GET", "/sites/abc/pages", http.StatusTeapot},
		{"HEAD", "/assets/app.js", http.StatusTeapot},
		{"GET", "/healthz", http.StatusOK},
		{"POST", "/api/event", http.StatusAccepted},
		{"GET", "/api", http.StatusNotFound},
		{"GET", "/api/nope", http.StatusNotFound},
		{"GET", "/api/event", http.StatusMethodNotAllowed},
		{"POST", "/", http.StatusNotFound},
		{"POST", "/healthz", http.StatusMethodNotAllowed},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.want {
			t.Errorf("%s %s = %d, want %d", tc.method, tc.path, w.Code, tc.want)
		}
	}
}

func TestHealthz(t *testing.T) {
	h, _, st := setupWithStore(t)
	health := func() (int, map[string]string, http.Header) {
		w := call(h, "GET", "/healthz", "", nil, "")
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("healthz body %q is not JSON: %v", w.Body, err)
		}
		return w.Code, body, w.Header()
	}
	code, body, hdr := health()
	if code != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("healthz = %d %v", code, body)
	}
	if hdr.Get("Content-Type") != "application/json" || hdr.Get("Cache-Control") != "no-store" {
		t.Fatalf("healthz headers = %v", hdr)
	}
	_ = st.Close()
	if code, body, _ := health(); code != http.StatusServiceUnavailable || body["status"] != "unavailable" || body["error"] == "" {
		t.Fatalf("healthz with closed db = %d %v, want 503 unavailable", code, body)
	}
}

func TestIngestIsWired(t *testing.T) {
	h, c, st := setupWithStore(t)
	site, _ := st.CreateSite(context.Background(), "", "mlz.no")
	req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(`{"site":"`+site.ID+`","url":"https://mlz.no/"}`))
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	req.Header.Set("Origin", "https://mlz.no")
	req.Header.Set("Sec-Fetch-Site", "cross-site") // the CSRF check must not apply here
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("event = %d %s", w.Code, w.Body)
	}
	if r := call(h, "GET", "/api/sites/"+site.ID+"/realtime", "", c, ""); !strings.Contains(r.Body.String(), `"visitors":1`) {
		t.Fatalf("realtime = %s", r.Body)
	}
}

func TestPixelIsWired(t *testing.T) {
	h, c, st := setupWithStore(t)
	site, _ := st.CreateSite(context.Background(), "", "mlz.no")
	if _, err := st.SetSitePixel(context.Background(), site.ID, true); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/pixel.gif?site="+site.ID+"&p=/readme", nil)
	req.Header.Set("User-Agent", "github-camo (876de43e)")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/gif" {
		t.Fatalf("pixel = %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	if r := call(h, "GET", "/api/sites/"+site.ID+"/realtime", "", c, ""); !strings.Contains(r.Body.String(), `"visitors":1`) {
		t.Fatalf("realtime = %s", r.Body)
	}
}

func TestGoalEndpoints(t *testing.T) {
	h, c := setup(t)
	js := "application/json"
	w := call(h, "POST", "/api/sites", `{"domain":"mlz.no"}`, c, js)
	var site struct{ ID string }
	_ = json.Unmarshal(w.Body.Bytes(), &site)
	base := "/api/sites/" + site.ID + "/goals"

	w = call(h, "POST", base, `{"kind":"event","value":"signup"}`, c, js)
	var goal struct {
		ID    int64
		Kind  string
		Value string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &goal); w.Code != http.StatusCreated || err != nil || goal.ID == 0 || goal.Value != "signup" {
		t.Fatalf("create = %d %s", w.Code, w.Body)
	}
	for _, c2 := range []struct {
		body string
		want int
	}{
		{`{"kind":"event","value":"signup"}`, http.StatusConflict},
		{`{"kind":"path","value":"no-slash"}`, http.StatusBadRequest},
		{`{"kind":"referrer","value":"x"}`, http.StatusBadRequest},
		{`not json`, http.StatusBadRequest},
	} {
		if w := call(h, "POST", base, c2.body, c, js); w.Code != c2.want {
			t.Errorf("POST %s = %d, want %d", c2.body, w.Code, c2.want)
		}
	}
	// The JSON Content-Type is the CSRF protection for POST.
	if w := call(h, "POST", base, `{"kind":"event","value":"form"}`, c, "text/plain"); w.Code != http.StatusBadRequest {
		t.Fatalf("text/plain create = %d, want 400", w.Code)
	}
	if w := call(h, "POST", "/api/sites/nope/goals", `{"kind":"event","value":"x"}`, c, js); w.Code != http.StatusNotFound {
		t.Fatalf("create on unknown site = %d, want 404", w.Code)
	}
	if w := call(h, "GET", base, "", nil, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list = %d, want 401", w.Code)
	}
	if w := call(h, "GET", base, "", c, ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"value":"signup"`) {
		t.Fatalf("list = %d %s", w.Code, w.Body)
	}
	if w := call(h, "GET", base+"/stats?from=2026-11-01&to=2026-11-03", "", c, ""); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"conversion_rate":0`) {
		t.Fatalf("stats = %d %s", w.Code, w.Body)
	}

	one := base + "/" + strconv.FormatInt(goal.ID, 10)
	req := httptest.NewRequest(http.MethodDelete, one, nil)
	req.AddCookie(c)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin delete = %d, want 403", rec.Code)
	}
	if w := call(h, "DELETE", one, "", c, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete = %d %s", w.Code, w.Body)
	}
	for _, path := range []string{one, base + "/abc"} {
		if w := call(h, "DELETE", path, "", c, ""); w.Code != http.StatusNotFound {
			t.Errorf("delete %s = %d, want 404", path, w.Code)
		}
	}
}

func TestExportEndpoint(t *testing.T) {
	h, c := setup(t)
	w := call(h, "POST", "/api/sites", `{"domain":"mlz.no"}`, c, "application/json")
	var site struct{ ID string }
	_ = json.Unmarshal(w.Body.Bytes(), &site)
	path := "/api/sites/" + site.ID + "/export?what=breakdown&dim=path"

	if w := call(h, "GET", path, "", nil, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export = %d, want 401", w.Code)
	}
	w = call(h, "GET", path, "", c, "")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "text/csv; charset=utf-8" ||
		!strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") ||
		!strings.HasPrefix(w.Body.String(), "\uFEFFpath,visitors,pageviews,") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("export = %d %v %q", w.Code, w.Header(), w.Body)
	}
	if w := call(h, "GET", "/api/sites/nope/export?what=timeseries", "", c, ""); w.Code != http.StatusNotFound {
		t.Fatalf("export of unknown site = %d, want 404", w.Code)
	}
}

// createSite creates a site through the API and returns its id.
func createSite(t *testing.T, h http.Handler, c *http.Cookie, body string) string {
	t.Helper()
	w := call(h, "POST", "/api/sites", body, c, "application/json")
	var site struct{ ID string }
	if err := json.Unmarshal(w.Body.Bytes(), &site); w.Code != http.StatusCreated || err != nil {
		t.Fatalf("create %s = %d %s", body, w.Code, w.Body)
	}
	return site.ID
}

func TestSiteEdgeCases(t *testing.T) {
	h, c := setup(t)
	const js = "application/json"
	id := createSite(t, h, c, `{"name":"Blog","domain":"mlz.no"}`)
	createSite(t, h, c, `{"domain":"other.no"}`)
	one := "/api/sites/" + id

	for _, tc := range []struct {
		name, method, path, body, ct string
		want                         int
	}{
		{"patch to a taken domain", "PATCH", one, `{"domain":"other.no"}`, js, http.StatusConflict},
		{"patch to an invalid domain", "PATCH", one, `{"domain":"no"}`, js, http.StatusBadRequest},
		{"patch invalid json", "PATCH", one, `{`, js, http.StatusBadRequest},
		{"patch text/plain", "PATCH", one, `{"name":"x"}`, "text/plain", http.StatusBadRequest},
		{"patch pixel on unknown site", "PATCH", "/api/sites/nope", `{"pixel_enabled":true}`, js, http.StatusNotFound},
		{"delete unknown site", "DELETE", "/api/sites/nope", "", "", http.StatusNotFound},
		{"create invalid json", "POST", "/api/sites", `{"domain":`, js, http.StatusBadRequest},
		{"wrong method", "PUT", "/api/sites", `{}`, js, http.StatusMethodNotAllowed},
	} {
		if w := call(h, tc.method, tc.path, tc.body, c, tc.ct); w.Code != tc.want {
			t.Errorf("%s = %d, want %d (%s)", tc.name, w.Code, tc.want, w.Body)
		}
	}

	var got struct{ ID, Name, Domain string }
	w := call(h, "GET", one, "", c, "")
	if err := json.Unmarshal(w.Body.Bytes(), &got); w.Code != http.StatusOK || err != nil || got.ID != id || got.Name != "Blog" || got.Domain != "mlz.no" {
		t.Fatalf("get = %d %s; rejected updates must leave the site unchanged", w.Code, w.Body)
	}

	// An empty body keeps the domain and resets the name to it (docs/reference/api.md).
	w = call(h, "PATCH", one, `{}`, c, js)
	if err := json.Unmarshal(w.Body.Bytes(), &got); w.Code != http.StatusOK || err != nil || got.Domain != "mlz.no" || got.Name != "mlz.no" {
		t.Fatalf("empty patch = %d %s", w.Code, w.Body)
	}

	w = call(h, "PATCH", one, `{"name":"  A\u0007B `+strings.Repeat("x", 200)+`"}`, c, js)
	if err := json.Unmarshal(w.Body.Bytes(), &got); w.Code != http.StatusOK || err != nil ||
		!strings.HasPrefix(got.Name, "AB x") || len([]rune(got.Name)) > 100 {
		t.Fatalf("long name = %d %q; want cleaned and at most 100 characters", w.Code, got.Name)
	}
}

func TestPurgeEdgeCases(t *testing.T) {
	h, c, st := setupWithStore(t)
	ctx := context.Background()
	const js = "application/json"
	site, _ := st.CreateSite(ctx, "", "mlz.no")
	other, _ := st.CreateSite(ctx, "", "other.no")
	day := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for _, e := range []struct {
		site, path string
		at         time.Time
	}{
		{site.ID, "/spam", day}, {site.ID, "/spam", day.Add(time.Hour)},
		{site.ID, "/keep", day},
		{site.ID, "/spam", day.AddDate(0, 0, 2)}, // outside the range
		{other.ID, "/spam", day},
	} {
		if err := st.InsertEvent(ctx, store.Event{SiteID: e.site, Time: e.at, Type: "pageview", Hostname: "mlz.no", Path: e.path}); err != nil {
			t.Fatal(err)
		}
	}
	base := "/api/sites/" + site.ID + "/purge"

	for name, tc := range map[string]struct {
		path, body, ct string
		want           int
	}{
		"missing from": {base, `{"to":"2026-11-02T00:00:00Z"}`, js, http.StatusBadRequest},
		"missing to":   {base, `{"from":"2026-11-01T00:00:00Z"}`, js, http.StatusBadRequest},
		"empty range":  {base, `{"from":"2026-11-01T00:00:00Z","to":"2026-11-01T00:00:00Z"}`, js, http.StatusBadRequest},
		"not rfc 3339": {base, `{"from":"2026-11-01","to":"2026-11-02"}`, js, http.StatusBadRequest},
		"invalid json": {base, `{`, js, http.StatusBadRequest},
		"text/plain":   {base, `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}`, "text/plain", http.StatusBadRequest},
		"unknown site": {"/api/sites/nope/purge", `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}`, js, http.StatusNotFound},
	} {
		if w := call(h, "POST", tc.path, tc.body, c, tc.ct); w.Code != tc.want {
			t.Errorf("%s = %d, want %d (%s)", name, w.Code, tc.want, w.Body)
		}
	}

	w := call(h, "POST", base, `{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z","path":"/spam"}`, c, js)
	if w.Code != http.StatusOK || w.Body.String() != `{"deleted":2}`+"\n" {
		t.Fatalf("purge = %d %q, want 2 deleted", w.Code, w.Body)
	}
	all := store.Range{From: day.AddDate(0, 0, -1), To: day.AddDate(0, 0, 5)}
	for id, want := range map[string]int64{site.ID: 2, other.ID: 1} {
		sum, err := st.Summary(ctx, id, all, nil)
		if err != nil {
			t.Fatal(err)
		}
		if sum.Pageviews != want {
			t.Errorf("site %s has %d pageviews after purge, want %d", id, sum.Pageviews, want)
		}
	}
}

func TestGoalEdgeCases(t *testing.T) {
	h, c := setup(t)
	const js = "application/json"
	id := createSite(t, h, c, `{"domain":"mlz.no"}`)
	otherID := createSite(t, h, c, `{"domain":"other.no"}`)
	base := "/api/sites/" + id + "/goals"

	if w := call(h, "GET", base+"/stats?from=2026-11-01", "", c, ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"goals":[]`) {
		t.Fatalf("stats without goals = %d %s", w.Code, w.Body)
	}
	for _, body := range []string{`{"kind":"event","value":""}`, `{"kind":"event","value":"   "}`, `{"kind":"path","value":""}`, `{"value":"x"}`} {
		if w := call(h, "POST", base, body, c, js); w.Code != http.StatusBadRequest {
			t.Errorf("POST %s = %d, want 400", body, w.Code)
		}
	}

	w := call(h, "POST", "/api/sites/"+otherID+"/goals", `{"kind":"event","value":"theirs"}`, c, js)
	var theirs struct{ ID int64 }
	if err := json.Unmarshal(w.Body.Bytes(), &theirs); w.Code != http.StatusCreated || err != nil {
		t.Fatalf("create = %d %s", w.Code, w.Body)
	}
	if w := call(h, "DELETE", base+"/"+strconv.FormatInt(theirs.ID, 10), "", c, ""); w.Code != http.StatusNotFound {
		t.Fatalf("delete another site's goal = %d, want 404", w.Code)
	}
	if w := call(h, "GET", "/api/sites/"+otherID+"/goals", "", c, ""); !strings.Contains(w.Body.String(), `"theirs"`) {
		t.Fatalf("the other site's goal is gone: %s", w.Body)
	}

	for i := range store.MaxGoals {
		if w := call(h, "POST", base, `{"kind":"event","value":"e`+strconv.Itoa(i)+`"}`, c, js); w.Code != http.StatusCreated {
			t.Fatalf("goal %d = %d %s", i, w.Code, w.Body)
		}
	}
	if w := call(h, "POST", base, `{"kind":"event","value":"one-too-many"}`, c, js); w.Code != http.StatusBadRequest {
		t.Fatalf("goal over the limit = %d, want 400", w.Code)
	}
}

func TestIngestRateIsWired(t *testing.T) {
	h, _, st := setupWithConfig(t, config.Config{PublicURL: publicURL, IngestRate: 1})
	site, _ := st.CreateSite(context.Background(), "", "mlz.no")
	codes := make([]int, 3)
	for i := range codes {
		req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(`{"site":"`+site.ID+`","url":"https://mlz.no/"}`))
		req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
		req.Header.Set("Origin", "https://mlz.no")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		codes[i] = w.Code
	}
	// INGEST_RATE=1 allows a burst of 2.
	if codes[0] != http.StatusAccepted || codes[1] != http.StatusAccepted || codes[2] != http.StatusServiceUnavailable {
		t.Fatalf("codes = %v, want [202 202 503]", codes)
	}
}
