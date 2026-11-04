// Package auth implements dashboard sign-in through an OAuth identity provider
// (GitHub for now) and server-side sessions stored in a cookie.
//
// There are no passwords: a user may sign in if their provider username is on
// the allowlist. On first sign-in the username is bound to the provider's
// stable account id, so a re-registered username cannot take over the account.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// CookieName must be "__session": Firebase Hosting strips every other cookie
// when proxying requests to Cloud Run. The same cookie therefore carries the
// short-lived OAuth state ("oauth.<state>") during sign-in.
const CookieName = "__session"

const (
	// SessionTTL is how long a sign-in lasts.
	SessionTTL = 30 * 24 * time.Hour
	// stateTTL is how long the user has to complete the provider's sign-in page.
	stateTTL    = 10 * time.Minute
	statePrefix = "oauth."
)

// Identity is a user as reported by a provider.
type Identity struct {
	ID    string // stable account id
	Login string // username
}

// Provider is an OAuth identity provider.
type Provider interface {
	// Name is used in URLs (/api/auth/{name}/login) and stored with the user.
	Name() string
	// AuthCodeURL is where the browser is sent to sign in.
	AuthCodeURL(state, redirectURI string) string
	// Identify exchanges the callback code for the user's identity.
	Identify(ctx context.Context, code, redirectURI string) (Identity, error)
}

// Store is the persistence used by auth.
type Store interface {
	LoginUser(ctx context.Context, provider, providerID, login string, now time.Time) (store.User, error)
	CreateSession(ctx context.Context, tokenHash []byte, userID int64, expires time.Time) error
	UserBySession(ctx context.Context, tokenHash []byte, now time.Time) (store.User, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteExpiredSessions(ctx context.Context, now time.Time) error
}

// Service handles sign-in, sign-out and session checks.
type Service struct {
	Store     Store
	Provider  Provider // nil disables sign-in
	Allowed   []string // provider usernames allowed to sign in (case-insensitive)
	PublicURL string   // dashboard base URL, e.g. https://analytics.example.com
	Log       *slog.Logger
	Now       func() time.Time
}

// Register adds the auth routes to mux.
func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/config", s.config)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.Handle("GET /api/auth/me", s.Require(http.HandlerFunc(s.me)))
	if s.Provider != nil {
		name := s.Provider.Name()
		mux.HandleFunc("GET /api/auth/"+name+"/login", s.login)
		mux.HandleFunc("GET /api/auth/"+name+"/callback", s.callback)
	}
}

type contextKey struct{}

// UserFrom returns the authenticated user set by Require.
func UserFrom(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(contextKey{}).(store.User)
	return u, ok
}

// Require rejects requests without a valid session with 401.
func (s *Service) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil || c.Value == "" || strings.HasPrefix(c.Value, statePrefix) {
			httpx.Error(w, http.StatusUnauthorized, "not signed in")
			return
		}
		u, err := s.Store.UserBySession(r.Context(), hashToken(c.Value), s.now())
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusUnauthorized, "not signed in")
			return
		}
		if err != nil {
			s.Log.Error("session lookup", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "internal error")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, u)))
	})
}

// config tells the dashboard which sign-in options exist.
func (s *Service) config(w http.ResponseWriter, _ *http.Request) {
	providers := []string{}
	if s.Provider != nil {
		providers = append(providers, s.Provider.Name())
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"providers": providers})
}

func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	state := newToken()
	http.SetCookie(w, s.cookie(statePrefix+state, s.now().Add(stateTTL)))
	http.Redirect(w, r, s.Provider.AuthCodeURL(state, s.redirectURI()), http.StatusFound)
}

// Error codes passed to the dashboard as ?auth_error=… after a failed sign-in.
const (
	errState      = "state"       // missing/mismatched state: expired or forged request
	errDenied     = "denied"      // user cancelled at the provider
	errNotAllowed = "not_allowed" // username not on the allowlist
	errConflict   = "conflict"    // username bound to a different account
	errFailed     = "failed"      // provider or server error
)

func (s *Service) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := r.Cookie(CookieName)
	want := statePrefix + q.Get("state")
	if err != nil || q.Get("state") == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(want)) != 1 {
		s.fail(w, r, errState)
		return
	}
	if q.Get("error") != "" || q.Get("code") == "" {
		s.fail(w, r, errDenied)
		return
	}

	ctx := r.Context()
	id, err := s.Provider.Identify(ctx, q.Get("code"), s.redirectURI())
	if err != nil {
		s.Log.Error("oauth identify", "provider", s.Provider.Name(), "err", err)
		s.fail(w, r, errFailed)
		return
	}
	if !s.allowed(id.Login) {
		s.Log.Warn("sign-in rejected: not on allowlist", "provider", s.Provider.Name(), "login", id.Login)
		s.fail(w, r, errNotAllowed)
		return
	}
	u, err := s.Store.LoginUser(ctx, s.Provider.Name(), id.ID, id.Login, s.now())
	if errors.Is(err, store.ErrIdentityConflict) {
		s.Log.Warn("sign-in rejected: identity conflict", "provider", s.Provider.Name(), "login", id.Login)
		s.fail(w, r, errConflict)
		return
	}
	if err != nil {
		s.Log.Error("login user", "err", err)
		s.fail(w, r, errFailed)
		return
	}

	token := newToken()
	expires := s.now().Add(SessionTTL)
	if err := s.Store.CreateSession(ctx, hashToken(token), u.ID, expires); err != nil {
		s.Log.Error("create session", "err", err)
		s.fail(w, r, errFailed)
		return
	}
	_ = s.Store.DeleteExpiredSessions(ctx, s.now())

	s.Log.Info("signed in", "provider", s.Provider.Name(), "login", u.Login)
	http.SetCookie(w, s.cookie(token, expires))
	http.Redirect(w, r, s.PublicURL+"/", http.StatusFound)
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, code string) {
	http.SetCookie(w, s.cookie("", time.Unix(0, 0)))
	http.Redirect(w, r, s.PublicURL+"/?auth_error="+url.QueryEscape(code), http.StatusFound)
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		_ = s.Store.DeleteSession(r.Context(), hashToken(c.Value))
	}
	http.SetCookie(w, s.cookie("", time.Unix(0, 0)))
	w.WriteHeader(http.StatusNoContent)
}

type userResponse struct {
	Login    string `json:"login"`
	Provider string `json:"provider"`
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) {
	u, _ := UserFrom(r.Context())
	httpx.WriteJSON(w, http.StatusOK, userResponse{Login: u.Login, Provider: u.Provider})
}

func (s *Service) allowed(login string) bool {
	for _, a := range s.Allowed {
		if strings.EqualFold(a, login) {
			return true
		}
	}
	return false
}

func (s *Service) redirectURI() string {
	return s.PublicURL + "/api/auth/" + s.Provider.Name() + "/callback"
}

func (s *Service) cookie(value string, expires time.Time) *http.Cookie {
	// Secure is on whenever PUBLIC_URL is https; it is off only for plain-HTTP local development.
	return &http.Cookie{ //nolint:gosec // G124: Secure is set dynamically
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   strings.HasPrefix(s.PublicURL, "https://"),
		SameSite: http.SameSiteLaxMode, // Lax: the cookie is sent on the top-level redirect back from the provider
	}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
