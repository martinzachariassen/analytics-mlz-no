package script

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/script.js", nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	Handler().ServeHTTP(w, req)
	return w
}

func TestHandler(t *testing.T) {
	w := get(t, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("content-type = %q", ct)
	}
	if ce := w.Header().Get("Content-Encoding"); ce != "" {
		t.Fatalf("content-encoding = %q without Accept-Encoding", ce)
	}
	if w.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("vary = %q", w.Header().Get("Vary"))
	}
	if !strings.Contains(w.Body.String(), "/api/event") {
		t.Fatal("script body does not look like the tracker")
	}

	// Revalidation with the ETag returns 304.
	if w2 := get(t, map[string]string{"If-None-Match": w.Header().Get("ETag")}); w2.Code != http.StatusNotModified {
		t.Fatalf("revalidation status = %d, want 304", w2.Code)
	}
}

func TestHandlerGzip(t *testing.T) {
	w := get(t, map[string]string{"Accept-Encoding": "br, gzip, deflate"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if ce := w.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("content-encoding = %q, want gzip", ce)
	}
	tag := w.Header().Get("ETag")
	if tag == etag {
		t.Fatal("gzip response must not reuse the identity ETag")
	}
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, script) {
		t.Fatal("decompressed body differs from script.js")
	}

	w2 := get(t, map[string]string{"Accept-Encoding": "gzip", "If-None-Match": tag})
	if w2.Code != http.StatusNotModified {
		t.Fatalf("revalidation status = %d, want 304", w2.Code)
	}
}

func TestAcceptsGzip(t *testing.T) {
	for header, want := range map[string]bool{
		"":                        false,
		"gzip":                    true,
		"GZIP":                    true,
		"br, gzip;q=0.8":          true,
		"deflate, gzip ; q=1.0":   true,
		"gzip;q=0":                false,
		"gzip; q=0.000, identity": false,
		"x-gzip, br":              false,
		"*":                       false,
	} {
		if got := acceptsGzip(header); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}
