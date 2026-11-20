package devdata

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDemo(t *testing.T) {
	h := Demo("abc123")
	serve := func(method, target string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		return rec
	}

	rec := serve(http.MethodGet, "/blog?utm_source=news")
	if rec.Code != http.StatusFound {
		t.Fatalf("without site: status %d, want 302", rec.Code)
	}
	ref, err := url.Parse(rec.Header().Get("Location"))
	if err != nil || ref.Host != "" || ref.Path != "" {
		t.Fatalf("redirect to %q, want a query-only reference", rec.Header().Get("Location"))
	}
	loc := (&url.URL{Path: "/blog"}).ResolveReference(ref)
	if loc.Path != "/blog" || loc.Query().Get("site") != "abc123" || loc.Query().Get("utm_source") != "news" {
		t.Fatalf("redirect to %q, want /blog with site and utm_source", rec.Header().Get("Location"))
	}

	if rec = serve(http.MethodGet, "//evil.example/x"); strings.Contains(rec.Header().Get("Location"), "evil") {
		t.Fatalf("redirect to %q leaves the demo site", rec.Header().Get("Location"))
	}

	rec = serve(http.MethodGet, "/blog/sqlite-on-cloud-run?site=abc123")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>Demo site</title>") {
		t.Fatalf("with site: status %d, body %.80q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("Content-Type %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q", cc)
	}

	if rec = serve(http.MethodPost, "/?site=abc123"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: status %d, want 405", rec.Code)
	}
}
