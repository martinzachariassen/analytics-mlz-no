// Package web serves the dashboard (apps/web/dist) from the binary, so an install without
// Firebase Hosting in front still gets it on the same origin as /api. The build copies dist
// into static/ first (`make embed-web`, the Dockerfile); a plain `go build` embeds only the
// placeholder, and that binary has no dashboard.
//
// Routing and headers mirror apps/web/firebase.json, which production uses; web_test.go
// holds the two together.
package web

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
)

//go:embed all:static
var embedded embed.FS

// Files is the embedded dashboard build.
var Files = func() fs.FS {
	sub, err := fs.Sub(embedded, "static")
	if err != nil {
		panic(err) // "static" is a valid path, so Sub cannot fail
	}
	return sub
}()

// headers are the ones firebase.json sets on every dashboard response, HSTS excepted: the
// server's own middleware adds that whenever PUBLIC_URL is https.
var headers = [][2]string{
	{"Cache-Control", "no-cache"},
	{"X-Content-Type-Options", "nosniff"},
	{"X-Robots-Tag", "noindex, nofollow"},
	{"Referrer-Policy", "strict-origin-when-cross-origin"},
	{"X-Frame-Options", "DENY"},
	{"Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()"},
	{"Content-Security-Policy", "default-src 'self'; script-src 'self' 'sha256-imIZm+vS/8092bJs21Seuk58M7RwafPNWLC/cToyPoI='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"},
}

// immutable are the folders whose file names carry a content hash, so they can be cached for good.
var immutable = []string{"assets/", "fonts/"}

const immutableCache = "public, max-age=31536000, immutable"

var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".svg":   "image/svg+xml",
	".txt":   "text/plain; charset=utf-8",
	".json":  "application/json",
	".woff2": "font/woff2",
	".png":   "image/png",
	".ico":   "image/x-icon",
}

type file struct {
	body, gz    []byte
	etag, etagz string
	contentType string
}

// Handler serves the dashboard in fsys, or returns nil when fsys has no index.html.
func Handler(fsys fs.FS) http.Handler {
	files := map[string]*file{}
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasPrefix(path.Base(name), ".") {
			return err
		}
		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		files[name] = newFile(name, body)
		return nil
	})
	if err != nil || files["index.html"] == nil {
		return nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		f := files[name]
		if f == nil {
			if hashed(name) {
				httpx.Error(w, http.StatusNotFound, "not found")
				return
			}
			f = files["index.html"]
		}
		h := w.Header()
		for _, kv := range headers {
			h.Set(kv[0], kv[1])
		}
		if hashed(name) {
			h.Set("Cache-Control", immutableCache)
		}
		if f.contentType != "" {
			h.Set("Content-Type", f.contentType)
		}
		body, tag := f.body, f.etag
		if f.gz != nil {
			h.Add("Vary", "Accept-Encoding")
			if httpx.AcceptsGzip(r.Header.Get("Accept-Encoding")) {
				body, tag = f.gz, f.etagz
				h.Set("Content-Encoding", "gzip")
			}
		}
		h.Set("ETag", tag)
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(body))
	})
}

// Embedded reports whether this binary was built with the dashboard.
func Embedded() bool {
	_, err := fs.Stat(Files, "index.html")
	return err == nil
}

func newFile(name string, body []byte) *file {
	sum := sha256.Sum256(body)
	tag := `"` + hex.EncodeToString(sum[:8]) + `"`
	f := &file{body: body, etag: tag, etagz: tag[:len(tag)-1] + `-gz"`, contentType: contentTypes[path.Ext(name)]}
	// Fonts and images are compressed already; gzip only pays off for text.
	if strings.HasPrefix(f.contentType, "text/") || f.contentType == "image/svg+xml" || f.contentType == "application/json" {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression) // error only for an invalid level
		_, _ = zw.Write(body)                                    // writes to a bytes.Buffer don't fail
		_ = zw.Close()
		if buf.Len() < len(body) {
			f.gz = buf.Bytes()
		}
	}
	return f
}

// hashed reports whether name is in a folder of content-hashed files. A missing file there is
// a 404, not the app's index page: a stale index.html asking for an old bundle must fail
// loudly instead of being handed HTML it cannot run, cached for a year.
func hashed(name string) bool {
	for _, dir := range immutable {
		if strings.HasPrefix(name, dir) {
			return true
		}
	}
	return false
}
