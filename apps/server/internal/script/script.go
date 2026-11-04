// Package script serves the embedded tracking script (built from apps/tracker with `npm run build`).
package script

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:embed script.js
var script []byte

// scriptGz is the script compressed once at startup; most clients accept gzip.
var scriptGz = func() []byte {
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression) // error only for an invalid level
	_, _ = zw.Write(script)                                  // writes to a bytes.Buffer don't fail
	_ = zw.Close()
	return buf.Bytes()
}()

var etag = func() string {
	sum := sha256.Sum256(script)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}()

// etagGz differs from etag because the encoded bytes differ (RFC 9110 §8.8.3).
var etagGz = etag[:len(etag)-1] + `-gz"`

// Handler serves GET /api/script.js.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Type", "text/javascript; charset=utf-8")
		// Short cache so tracker updates roll out quickly; ETag makes revalidation cheap.
		h.Set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
		h.Add("Vary", "Accept-Encoding")

		body, tag := script, etag
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			body, tag = scriptGz, etagGz
			h.Set("Content-Encoding", "gzip")
		}
		h.Set("ETag", tag)
		http.ServeContent(w, r, "script.js", time.Time{}, bytes.NewReader(body))
	})
}

// acceptsGzip reports whether an Accept-Encoding header allows gzip (and doesn't refuse it with q=0).
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		coding, params, _ := strings.Cut(part, ";")
		if !strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			continue
		}
		for _, p := range strings.Split(params, ";") {
			k, v, _ := strings.Cut(strings.TrimSpace(p), "=")
			if strings.EqualFold(k, "q") {
				q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				return err == nil && q > 0
			}
		}
		return true
	}
	return false
}
