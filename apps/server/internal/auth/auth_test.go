package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

type fakeUser struct {
	ID    int64
	Login string
}

// fakeGitHub emulates GitHub's token and user endpoints. The code determines the user.
// It enforces PKCE: the verifier sent with the code must hash to the challenge seen at
// authorization time.
func fakeGitHub(t *testing.T, users map[string]fakeUser) *httptest.Server {
	t.Helper()
	var lastChallenge string
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login/oauth/authorize", func(_ http.ResponseWriter, r *http.Request) {
		lastChallenge = r.URL.Query().Get("code_challenge")
	})
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
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if lastChallenge != "" && base64.RawURLEncoding.EncodeToString(sum[:]) != lastChallenge {
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "pkce_mismatch"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-" + r.Form.Get("code")})
	})
	mux.HandleFunc("GET /user", func(w http.ResponseWriter, r *http.Request) {
		code := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer tok-")
		if code == "broken" {
			http.Error(w, "nope", http.StatusBadGateway)
			return
		}
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
	st  *store.Store
	now time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	gh := fakeGitHub(t, map[string]fakeUser{
		"martin":   {1, "MartinZachariassen"},
		"stranger": {2, "stranger"},
		"squatter": {3, "martinzachariassen"}, // same username, different account
		"broken":   {4, "broken"},
	})
	h := &harness{t: t, st: st, now: time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)}
	h.svc = &Service{
		Store: st,
		Provider: &GitHub{ClientID: "id", ClientSecret: "secret",
			AuthURL: gh.URL + "/login/oauth/authorize", TokenURL: gh.URL + "/login/oauth/access_token", APIURL: gh.URL},
		Allowed:   []string{"martinzachariassen", "broken"},
		PublicURL: "https://stats.example.com",
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:       func() time.Time { return h.now },
	}
	h.mux = http.NewServeMux()
	h.svc.Register(h.mux)
	return h
}

func (h *harness) do(method, path string, cookie *http.Cookie, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w
}

// visit fetches the provider's authorize page, as the browser would.
func (h *harness) visit(u string) {
	h.t.Helper()
	resp, err := http.Get(u) //nolint:noctx // test
	if err != nil {
		h.t.Fatal(err)
	}
	_ = resp.Body.Close()
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
	q := loc.Query()
	if q.Has("scope") || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" ||
		q.Get("redirect_uri") != "https://stats.example.com/api/auth/github/callback" {
		h.t.Fatalf("unexpected authorize URL %s", loc)
	}
	// The browser visits the provider, which records the challenge.
	h.visit(loc.String())
	return h.do("GET", "/api/auth/github/callback?code="+code+"&state="+q.Get("state"), sessionCookie(w))
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
	if want := h.now.Add(SessionTTL); !c.Expires.Equal(want) {
		t.Fatalf("cookie expires %v, want %v", c.Expires, want)
	}

	me := h.do("GET", "/api/auth/me", c)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"login":"MartinZachariassen"`) {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}

	if out := h.do("POST", "/api/auth/logout", c, "Origin", "https://stats.example.com"); out.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d", out.Code)
	}
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout = %d, want 401", me.Code)
	}
}

func TestSignInRejected(t *testing.T) {
	h := newHarness(t)
	validState := func() (*http.Cookie, string) {
		w := h.do("GET", "/api/auth/github/login", nil)
		loc, _ := url.Parse(w.Header().Get("Location"))
		return sessionCookie(w), loc.Query().Get("state")
	}
	cases := map[string]struct {
		run  func() *httptest.ResponseRecorder
		want string
	}{
		"not on allowlist": {func() *httptest.ResponseRecorder { return h.signIn("stranger") }, errNotAllowed},
		"bad code":         {func() *httptest.ResponseRecorder { return h.signIn("nope") }, errFailed},
		"provider error":   {func() *httptest.ResponseRecorder { return h.signIn("broken") }, errFailed},
		"missing state cookie": {func() *httptest.ResponseRecorder {
			return h.do("GET", "/api/auth/github/callback?code=martin&state=abc", nil)
		}, errState},
		"forged state": {func() *httptest.ResponseRecorder {
			c, _ := validState()
			return h.do("GET", "/api/auth/github/callback?code=martin&state=abc", c)
		}, errState},
		"old-format state cookie": {func() *httptest.ResponseRecorder {
			return h.do("GET", "/api/auth/github/callback?code=martin&state=abc",
				&http.Cookie{Name: CookieName, Value: statePrefix + "abc"})
		}, errState},
		"expired state": {func() *httptest.ResponseRecorder {
			c, state := validState()
			h.now = h.now.Add(stateTTL + time.Second)
			defer func() { h.now = h.now.Add(-stateTTL - time.Second) }()
			return h.do("GET", "/api/auth/github/callback?code=martin&state="+state, c)
		}, errState},
		"user cancelled": {func() *httptest.ResponseRecorder {
			c, state := validState()
			return h.do("GET", "/api/auth/github/callback?error=access_denied&state="+state, c)
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

func TestPKCEVerifierIsChecked(t *testing.T) {
	h := newHarness(t)
	w := h.do("GET", "/api/auth/github/login", nil)
	loc, _ := url.Parse(w.Header().Get("Location"))
	h.visit(loc.String())
	// A cookie with the right state but another verifier: the provider refuses the exchange.
	parts := strings.Split(strings.TrimPrefix(sessionCookie(w).Value, statePrefix), ".")
	forged := &http.Cookie{Name: CookieName, Value: statePrefix + parts[0] + ".wrong-verifier." + parts[2]}
	cb := h.do("GET", "/api/auth/github/callback?code=martin&state="+parts[0], forged)
	if got := cb.Header().Get("Location"); !strings.HasSuffix(got, "auth_error="+errFailed) {
		t.Fatalf("location = %q, want a failed sign-in", got)
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

func TestSessionExpires(t *testing.T) {
	h := newHarness(t)
	c := sessionCookie(h.signIn("martin"))
	h.now = h.now.Add(SessionTTL + time.Second)
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusUnauthorized {
		t.Fatalf("me after expiry = %d, want 401", me.Code)
	}
}

func TestSessionSlidesWithUse(t *testing.T) {
	h := newHarness(t)
	c := sessionCookie(h.signIn("martin"))

	// Within the first day nothing is renewed.
	h.now = h.now.Add(time.Hour)
	if w := h.do("GET", "/api/auth/me", c); w.Code != http.StatusOK || sessionCookie(w) != nil {
		t.Fatalf("early request: %d, cookie %v", w.Code, sessionCookie(w))
	}
	// After a day of the lifetime has passed, a request extends the session by a full TTL.
	h.now = h.now.Add(SessionRenewAfter)
	w := h.do("GET", "/api/auth/me", c)
	renewed := sessionCookie(w)
	if w.Code != http.StatusOK || renewed == nil || renewed.Value != c.Value || !renewed.Expires.Equal(h.now.Add(SessionTTL)) {
		t.Fatalf("renewal: %d, cookie %+v", w.Code, renewed)
	}
	// The original expiry has passed, but the renewed session is still valid.
	h.now = h.now.Add(SessionTTL - time.Hour)
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusOK {
		t.Fatalf("me after renewal = %d, want 200", me.Code)
	}
}

func TestRemovedFromAllowlistIsSignedOut(t *testing.T) {
	h := newHarness(t)
	c := sessionCookie(h.signIn("martin"))
	h.svc.Allowed = []string{"someone-else"}
	w := h.do("GET", "/api/auth/me", c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("me = %d, want 401", w.Code)
	}
	if cleared := sessionCookie(w); cleared == nil || cleared.Value != "" {
		t.Fatalf("cookie not cleared: %+v", cleared)
	}
	// Re-adding the user does not revive the old session: it was deleted.
	h.svc.Allowed = []string{"martinzachariassen"}
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusUnauthorized {
		t.Fatalf("me after re-adding = %d, want 401 (session deleted)", me.Code)
	}
}

func TestLoginReplacesExistingSession(t *testing.T) {
	h := newHarness(t)
	first := sessionCookie(h.signIn("martin"))
	// Starting a new sign-in while signed in ends the old session server-side.
	h.do("GET", "/api/auth/github/login", first)
	if me := h.do("GET", "/api/auth/me", first); me.Code != http.StatusUnauthorized {
		t.Fatalf("old session after new login = %d, want 401", me.Code)
	}
}

func TestFailedCallbackKeepsExistingSession(t *testing.T) {
	h := newHarness(t)
	c := sessionCookie(h.signIn("martin"))
	// A cross-site link to the callback with a real session cookie must not sign the user out.
	w := h.do("GET", "/api/auth/github/callback?code=x&state=abc", c)
	if cleared := sessionCookie(w); cleared != nil {
		t.Fatalf("session cookie was cleared: %+v", cleared)
	}
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusOK {
		t.Fatalf("me = %d, want 200", me.Code)
	}
}
