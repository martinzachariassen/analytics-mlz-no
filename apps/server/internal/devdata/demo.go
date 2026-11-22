package devdata

import (
	_ "embed"
	"net/http"
)

//go:embed demo/index.html
var demoPage []byte

// Demo serves the demo page, which sends real events for siteID through the tracking script.
// Every path returns the page, so a reload of one of its client-side routes still works.
// A request without ?site= is redirected to one with it; the page reads the id and then
// removes it from the URL.
func Demo(siteID string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		q := r.URL.Query()
		if q.Get("site") == "" {
			q.Set("site", siteID)
			// A query-only reference keeps the browser on the same path and host; building the
			// target from the path would turn "//other.example" into an open redirect.
			w.Header().Set("Location", "?"+q.Encode())
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(demoPage)
	})
}
