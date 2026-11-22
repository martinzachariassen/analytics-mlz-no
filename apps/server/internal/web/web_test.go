package web

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

var dist = fstest.MapFS{
	"index.html":           {Data: []byte("<!doctype html><title>app</title>" + strings.Repeat(" ", 200))},
	"favicon.svg":          {Data: []byte("<svg/>")},
	"assets/index-abc.js":  {Data: []byte("console.log(1)" + strings.Repeat(";", 200))},
	"fonts/geist.woff2":    {Data: []byte("wOF2")},
	"robots.txt":           {Data: []byte("User-agent: *\nDisallow: /\n")},
	"assets/.hidden-thing": {Data: []byte("x")},
}

func get(t *testing.T, h http.Handler, path string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestHandlerWithoutBuild(t *testing.T) {
	if Handler(fstest.MapFS{".gitkeep": {}}) != nil {
		t.Fatal("a build without index.html must not serve a dashboard")
	}
}

func TestRouting(t *testing.T) {
	h := Handler(dist)
	for path, want := range map[string]string{
		"/":                 "<title>app</title>",
		"/sites/abc/pages":  "<title>app</title>",
		"/settings":         "<title>app</title>",
		"/assets":           "<title>app</title>",
		"/favicon.svg":      "<svg/>",
		"/../../etc/passwd": "<title>app</title>",
	} {
		w := get(t, h, path, nil)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), want) {
			t.Errorf("GET %s = %d %q, want %q", path, w.Code, w.Body, want)
		}
	}
	for _, path := range []string{"/assets/index-old.js", "/fonts/gone.woff2", "/assets/.hidden-thing"} {
		if w := get(t, h, path, nil); w.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, w.Code)
		}
	}
}

func TestHeaders(t *testing.T) {
	h := Handler(dist)
	w := get(t, h, "/sites/abc", nil)
	for _, kv := range headers {
		if got := w.Header().Get(kv[0]); got != kv[1] {
			t.Errorf("%s = %q, want %q", kv[0], got, kv[1])
		}
	}
	if got := w.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	for path, want := range map[string]string{
		"/assets/index-abc.js": immutableCache,
		"/fonts/geist.woff2":   immutableCache,
		"/favicon.svg":         "no-cache",
	} {
		if got := get(t, h, path, nil).Header().Get("Cache-Control"); got != want {
			t.Errorf("Cache-Control for %s = %q, want %q", path, got, want)
		}
	}
	if got := get(t, h, "/fonts/geist.woff2", nil).Header().Get("Content-Type"); got != "font/woff2" {
		t.Errorf("font Content-Type = %q", got)
	}
}

func TestGzipAndETag(t *testing.T) {
	h := Handler(dist)
	w := get(t, h, "/assets/index-abc.js", map[string]string{"Accept-Encoding": "gzip"})
	if w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("headers = %v", w.Header())
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if !bytes.Equal(body, dist["assets/index-abc.js"].Data) {
		t.Fatal("gzip body differs from the file")
	}
	plain := get(t, h, "/assets/index-abc.js", nil)
	if plain.Header().Get("Content-Encoding") != "" || plain.Header().Get("ETag") == w.Header().Get("ETag") {
		t.Fatalf("identity response must not share the gzip ETag: %v", plain.Header())
	}
	if w := get(t, h, "/assets/index-abc.js", map[string]string{"If-None-Match": plain.Header().Get("ETag")}); w.Code != http.StatusNotModified {
		t.Fatalf("revalidation = %d, want 304", w.Code)
	}
	if w := get(t, h, "/fonts/geist.woff2", map[string]string{"Accept-Encoding": "gzip"}); w.Header().Get("Content-Encoding") != "" {
		t.Fatal("fonts are compressed already")
	}
}

// firebase.json is what production serves the dashboard with; the binary must answer the same.
func TestMatchesFirebaseHosting(t *testing.T) {
	raw, err := os.ReadFile("../../../web/firebase.json")
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Hosting struct {
			Rewrites []struct {
				Source, Destination string
			}
			Headers []struct {
				Source  string
				Headers []struct{ Key, Value string }
			}
		}
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}

	for _, hdr := range cfg.Hosting.Headers {
		switch {
		case hdr.Source == "**":
			var got [][2]string
			for _, kv := range hdr.Headers {
				if kv.Key != "Strict-Transport-Security" {
					got = append(got, [2]string{kv.Key, kv.Value})
				}
			}
			if !slices.Equal(got, headers) {
				t.Errorf("headers for ** differ from firebase.json:\n got %v\nwant %v", headers, got)
			}
		case len(hdr.Headers) == 1 && hdr.Headers[0].Key == "Cache-Control" && hdr.Headers[0].Value == immutableCache:
			dir := strings.TrimSuffix(strings.TrimPrefix(hdr.Source, "/"), "**")
			if !slices.Contains(immutable, dir) {
				t.Errorf("firebase.json caches %s for good; add %q to immutable", hdr.Source, dir)
			}
		default:
			t.Errorf("firebase.json sets headers on %s that the embedded dashboard does not know", hdr.Source)
		}
	}

	h := Handler(dist)
	for _, rw := range cfg.Hosting.Rewrites {
		if rw.Destination == "" {
			continue // the /api/** rewrite to Cloud Run; the server answers /api itself
		}
		path := strings.ReplaceAll(rw.Source, "**", "some/route")
		if path == "some/route" {
			path = "/some/route"
		}
		want := dist[strings.TrimPrefix(rw.Destination, "/")]
		if want == nil {
			t.Fatalf("rewrite %s -> %s: destination missing from the test build", rw.Source, rw.Destination)
		}
		if w := get(t, h, path, nil); w.Body.String() != string(want.Data) {
			t.Errorf("rewrite %s -> %s: GET %s served %q", rw.Source, rw.Destination, path, w.Body)
		}
	}
}
