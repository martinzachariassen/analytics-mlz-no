// Package script serves the embedded tracking script (built from apps/tracker with `npm run build`).
package script

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"net/http"
	"time"
)

//go:embed script.js
var script []byte

var etag = func() string {
	sum := sha256.Sum256(script)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}()

// Handler serves GET /api/script.js.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Type", "text/javascript; charset=utf-8")
		// Short cache so tracker updates roll out quickly; ETag makes revalidation cheap.
		h.Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
		h.Set("ETag", etag)
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
		http.ServeContent(w, r, "script.js", time.Time{}, bytes.NewReader(script))
	})
}
