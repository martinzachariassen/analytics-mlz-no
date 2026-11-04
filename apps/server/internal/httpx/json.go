package httpx

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"
)

// WriteJSON writes v as JSON with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes {"error": msg} with the given status.
func Error(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}

// ErrNotJSON is returned by ReadJSON when the request is not application/json.
var ErrNotJSON = errors.New("content type must be application/json")

// ReadJSON decodes a JSON request body into v (max 64 KB, unknown fields rejected).
//
// Requiring application/json also protects cookie-authenticated endpoints from CSRF:
// cross-site HTML forms cannot send that content type, and cross-origin fetch
// triggers a CORS preflight that the API never approves.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		return ErrNotJSON
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
