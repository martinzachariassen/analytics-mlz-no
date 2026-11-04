package auth

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

func TestDevSignIn(t *testing.T) {
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "dev.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc := &Service{
		Store:     st,
		Provider:  Dev{},
		Allowed:   []string{DevLogin},
		PublicURL: "http://localhost:5173",
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	mux := http.NewServeMux()
	svc.Register(mux)
	h := &harness{t: t, mux: mux, svc: svc}

	login := h.do("GET", "/api/auth/dev/login", nil)
	loc := login.Header().Get("Location")
	if login.Code != http.StatusFound || !strings.HasPrefix(loc, "http://localhost:5173/api/auth/dev/callback?") {
		t.Fatalf("login: status %d, location %q", login.Code, loc)
	}

	cb := h.do("GET", strings.TrimPrefix(loc, "http://localhost:5173"), sessionCookie(login))
	if cb.Code != http.StatusFound || cb.Header().Get("Location") != "http://localhost:5173/" {
		t.Fatalf("callback: status %d, location %q", cb.Code, cb.Header().Get("Location"))
	}
	c := sessionCookie(cb)
	if c == nil || c.Secure {
		t.Fatalf("want a non-Secure session cookie on http, got %+v", c)
	}
	if me := h.do("GET", "/api/auth/me", c); me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"login":"dev"`) {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}

	// The callback still requires the state cookie.
	if w := h.do("GET", strings.TrimPrefix(loc, "http://localhost:5173"), nil); !strings.Contains(w.Header().Get("Location"), "auth_error=state") {
		t.Fatalf("callback without state cookie: location %q", w.Header().Get("Location"))
	}
}
