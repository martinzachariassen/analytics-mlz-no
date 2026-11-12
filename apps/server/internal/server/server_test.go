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
	if err := st.CreateSession(ctx, sum[:], u.ID, time.Now().Add(auth.SessionTTL)); err != nil {
		t.Fatal(err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	loc, _ := geo.Open("")
	authn := &auth.Service{Store: st, PublicURL: publicURL, Allowed: []string{"martin"}, Log: log}
	h := New(config.Config{PublicURL: publicURL}, st, authn, loc, log)
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

func TestDeleteRequiresSameOrigin(t *testing.T) {
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
	}
	for name, path := range bad {
		if w := call(h, "GET", path, "", c, ""); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400 (%s)", name, w.Code, w.Body)
		}
	}
	for _, path := range []string{"/stats", "/breakdown?dim=path", "/heatmap", "/realtime", ""} {
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
	for _, path := range []string{"/api/script.js", "/api/auth/me", "/healthz", "/does-not-exist", "/api/sites"} {
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
	w := call(h, "GET", "/nope", "", nil, "")
	if w.Code != http.StatusNotFound || w.Header().Get("Content-Type") != "application/json" || !strings.Contains(w.Body.String(), `"not found"`) {
		t.Fatalf("404 = %d %q %q", w.Code, w.Header().Get("Content-Type"), w.Body)
	}
	w = call(h, "GET", "/api/event", "", nil, "")
	if w.Code != http.StatusMethodNotAllowed || !strings.Contains(w.Header().Get("Allow"), "POST") || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("405 = %d allow=%q %q", w.Code, w.Header().Get("Allow"), w.Body)
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
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("event = %d %s", w.Code, w.Body)
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
