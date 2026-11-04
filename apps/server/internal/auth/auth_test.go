package auth

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// fakeGitHub emulates GitHub's token and user endpoints. The code determines the user.
func fakeGitHub(t *testing.T, users map[string]struct {
	ID    int64
	Login string
}) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /login/oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_secret") != "secret" {
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "incorrect_client_credentials"})
			return
		}
		if _, ok := users[r.Form.Get("code")]; !ok {
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-" + r.Form.Get("code")})
	})
	mux.HandleFunc("GET /user", func(w http.ResponseWriter, r *http.Request) {
		code := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer tok-")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": users[code].ID, "login": users[code].Login})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

type harness struct {
	t   *testing.T
	mux *http.ServeMux
	svc *Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	gh := fakeGitHub(t, map[string]struct {
		ID    int64
		Login string
	}{
		"martin":   {1, "MartinZachariassen"},
		"stranger": {2, "stranger"},
		"squatter": {3, "martinzachariassen"}, // same username, different account
	})
	svc := &Service{
		Store: st,
		Provider: &GitHub{ClientID: "id", ClientSecret: "secret",
			AuthURL: gh.URL + "/login/oauth/authorize", TokenURL: gh.URL + "/login/oauth/access_token", APIURL: gh.URL},
		Allowed:   []string{"martinzachariassen"},
		PublicURL: "https://stats.example.com",
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	mux := http.NewServeMux()
	svc.Register(mux)
	return &harness{t: t, mux: mux, svc: svc}
}

func (h *harness) do(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w
}

func sessionCookie(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == CookieName {
			return c
		}
	}
	return nil
}

// signIn runs the full OAuth flow for the fake user identified by code.
func (h *harness) signIn(code string) *httptest.ResponseRecorder {
	h.t.Helper()
	w := h.do("GET", "/api/auth/github/login", nil)
	if w.Code != http.StatusFound {
		h.t.Fatalf("login status = %d", w.Code)
	}
	loc, _ := url.Parse(w.Header().Get("Location"))
	if loc.Query().Get("scope") != "read:user" ||
		loc.Query().Get("redirect_uri") != "https://stats.example.com/api/auth/github/callback" {
		h.t.Fatalf("unexpected authorize URL %s", loc)
	}
	return h.do("GET", "/api/auth/github/callback?code="+code+"&state="+loc.Query().Get("state"), sessionCookie(w))
}

func TestSignInFlow(t *testing.T) {
	h := newHarness(t)
	w := h.signIn("martin")
	if w.Code != http.StatusFound || w.Header().Get("Location") != "https://stats.example.com/" {
		t.Fatalf("callback: status %d, location %q", w.Code, w.Header().Get("Location"))
	}
	c := sessionCookie(w)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || strings.HasPrefix(c.Value, statePrefix) {
		t.Fatalf("bad session cookie: %+v", c)
	}

	me := h.do("GET", "/api/auth/me", c)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"login":"MartinZachariassen"`) {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}

	if out := h.do("POST", "/api/auth/logout", c); out.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d", out.Code)
	}
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout = %d, want 401", me.Code)
	}
}

func TestSignInRejected(t *testing.T) {
	h := newHarness(t)
	cases := map[string]struct {
		run  func() *httptest.ResponseRecorder
		want string
	}{
		"not on allowlist": {func() *httptest.ResponseRecorder { return h.signIn("stranger") }, errNotAllowed},
		"bad code":         {func() *httptest.ResponseRecorder { return h.signIn("nope") }, errFailed},
		"missing state cookie": {func() *httptest.ResponseRecorder {
			return h.do("GET", "/api/auth/github/callback?code=martin&state=abc", nil)
		}, errState},
		"forged state": {func() *httptest.ResponseRecorder {
			return h.do("GET", "/api/auth/github/callback?code=martin&state=abc",
				&http.Cookie{Name: CookieName, Value: statePrefix + "xyz"})
		}, errState},
		"user cancelled": {func() *httptest.ResponseRecorder {
			c := &http.Cookie{Name: CookieName, Value: statePrefix + "abc"}
			return h.do("GET", "/api/auth/github/callback?error=access_denied&state=abc", c)
		}, errDenied},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			w := c.run()
			if want := "https://stats.example.com/?auth_error=" + c.want; w.Header().Get("Location") != want {
				t.Fatalf("location = %q, want %q", w.Header().Get("Location"), want)
			}
		})
	}
}

func TestUsernameSquattingRejected(t *testing.T) {
	h := newHarness(t)
	if c := sessionCookie(h.signIn("martin")); c == nil || c.Value == "" {
		t.Fatal("first sign-in should succeed")
	}
	// Same username (allowlisted), but a different GitHub account id.
	w := h.signIn("squatter")
	if got := w.Header().Get("Location"); got != "https://stats.example.com/?auth_error="+errConflict {
		t.Fatalf("location = %q", got)
	}
}

func TestStateCookieIsNotASession(t *testing.T) {
	h := newHarness(t)
	w := h.do("GET", "/api/auth/github/login", nil)
	if me := h.do("GET", "/api/auth/me", sessionCookie(w)); me.Code != http.StatusUnauthorized {
		t.Fatalf("me with state cookie = %d, want 401", me.Code)
	}
}

func TestConfig(t *testing.T) {
	h := newHarness(t)
	w := h.do("GET", "/api/auth/config", nil)
	if !strings.Contains(w.Body.String(), `"providers":["github"]`) {
		t.Fatalf("config = %s", w.Body)
	}
}
