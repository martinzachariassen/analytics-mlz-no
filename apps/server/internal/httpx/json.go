package httpx

import (
	"encoding/json"
	"errors"
	"io"
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

// MaxJSONBody is the largest request body ReadJSON accepts.
const MaxJSONBody = 64 << 10

// ReadJSON decodes a JSON request body into v: at most MaxJSONBody bytes, unknown fields
// rejected, and exactly one JSON value.
//
// Requiring application/json is a second CSRF layer behind the router's cross-origin
// check: cross-site HTML forms cannot send that content type, and cross-origin fetch
// triggers a CORS preflight that the API never approves.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		return ErrNotJSON
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxJSONBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("unexpected data after JSON body")
	}
	return nil
}
