package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGitHubIdentifyErrors(t *testing.T) {
	for _, c := range []struct {
		name, token, user string
		tokenStatus       int
		want              string
	}{
		{"token endpoint down", ``, ``, http.StatusBadGateway, "token exchange: unexpected status"},
		{"token refused", `{"error":"bad_verification_code","error_description":"expired"}`, ``, http.StatusOK, "bad_verification_code expired"},
		{"token not JSON", `<html>`, ``, http.StatusOK, "token exchange: invalid character"},
		{"empty user", `{"access_token":"t"}`, `{}`, http.StatusOK, "fetch user: empty response"},
		{"user without login", `{"access_token":"t"}`, `{"id":7}`, http.StatusOK, "fetch user: empty response"},
	} {
		t.Run(c.name, func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc("POST /token", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.tokenStatus)
				_, _ = w.Write([]byte(c.token))
			})
			mux.HandleFunc("GET /user", func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(c.user))
			})
			srv := httptest.NewServer(mux)
			defer srv.Close()
			g := &GitHub{TokenURL: srv.URL + "/token", APIURL: srv.URL}
			_, err := g.Identify(context.Background(), "code", "https://x/cb", "verifier")
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want it to contain %q", err, c.want)
			}
		})
	}
}

func TestGitHubIdentify(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"access_token":"t"}`))
	})
	mux.HandleFunc("GET /user", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer t" {
			http.Error(w, "no token", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"id":42,"login":"octo"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	g := &GitHub{TokenURL: srv.URL + "/token", APIURL: srv.URL}
	id, err := g.Identify(context.Background(), "code", "https://x/cb", "verifier")
	if err != nil || id.ID != "42" || id.Login != "octo" {
		t.Fatalf("Identify = %+v, %v", id, err)
	}
}
