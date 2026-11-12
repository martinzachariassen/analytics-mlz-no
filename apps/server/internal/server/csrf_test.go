package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCrossOriginProtection(t *testing.T) {
	h, c := setup(t)
	send := func(method, path, body string, headers ...string) int {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Host = "analytics-123.europe-north1.run.app" // what Cloud Run sees behind Firebase Hosting
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for i := 0; i < len(headers); i += 2 {
			req.Header.Set(headers[i], headers[i+1])
		}
		req.AddCookie(c)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	cases := []struct {
		name, method, path, body string
		headers                  []string
		want                     int
	}{
		{"cross-site create", "POST", "/api/sites", `{"domain":"a.example"}`, []string{"Sec-Fetch-Site", "cross-site"}, http.StatusForbidden},
		{"same-site but other origin", "POST", "/api/sites", `{"domain":"a.example"}`, []string{"Sec-Fetch-Site", "same-site"}, http.StatusForbidden},
		{"foreign origin, no fetch metadata", "POST", "/api/sites", `{"domain":"a.example"}`, []string{"Origin", "https://evil.example"}, http.StatusForbidden},
		{"cross-site logout", "POST", "/api/auth/logout", "", []string{"Sec-Fetch-Site", "cross-site"}, http.StatusForbidden},
		{"cross-site delete", "DELETE", "/api/sites/nope", "", []string{"Sec-Fetch-Site", "cross-site"}, http.StatusForbidden},
		{"cross-site read is a safe method", "GET", "/api/sites", "", []string{"Sec-Fetch-Site", "cross-site"}, http.StatusOK},
		{"dashboard origin behind a proxy", "POST", "/api/sites", `{"domain":"b.example"}`, []string{"Origin", publicURL}, http.StatusCreated},
		{"same-origin fetch", "POST", "/api/sites", `{"domain":"c.example"}`, []string{"Sec-Fetch-Site", "same-origin", "Origin", publicURL}, http.StatusCreated},
		{"non-browser client", "DELETE", "/api/sites/nope", "", nil, http.StatusNotFound},
	}
	for _, tc := range cases {
		if got := send(tc.method, tc.path, tc.body, tc.headers...); got != tc.want {
			t.Errorf("%s: %s %s = %d, want %d", tc.name, tc.method, tc.path, got, tc.want)
		}
	}

	// The session survives the rejected logout.
	if got := send("GET", "/api/auth/me", ""); got != http.StatusOK {
		t.Fatalf("me after rejected logout = %d, want 200", got)
	}
}
