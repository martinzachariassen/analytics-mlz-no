package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name string
		xff  string
		hops int
		want string
	}{
		{"no proxy uses remote addr", "1.1.1.1", 0, "192.0.2.1"},
		{"one hop", "203.0.113.5", 1, "203.0.113.5"},
		{"spoofed entry ignored", "6.6.6.6, 203.0.113.5", 1, "203.0.113.5"},
		{"two hops", "6.6.6.6, 203.0.113.5, 10.0.0.1", 2, "203.0.113.5"},
		{"fewer entries than hops", "203.0.113.5", 3, "203.0.113.5"},
		{"fewer entries than hops uses nearest proxy", "6.6.6.6, 203.0.113.5", 3, "203.0.113.5"},
		{"no header falls back", "", 1, "192.0.2.1"},
		{"junk entry falls back to remote addr", "not-an-ip, 203.0.113.5", 2, "192.0.2.1"},
		{"huge entry falls back", strings.Repeat("x", 10_000) + ", 203.0.113.5", 2, "192.0.2.1"},
		{"ipv4-mapped is canonical", "::ffff:203.0.113.5", 1, "203.0.113.5"},
		{"ipv6 with brackets and port", "[2001:db8::1]:443", 1, "2001:db8::1"},
		{"ipv6 zone dropped", "fe80::1%eth0", 1, "fe80::1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = "192.0.2.1:1234"
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := ClientIP(r, c.hops); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestClientIPIPv6RemoteAddr(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "[2001:db8::7]:5000"
	if got := ClientIP(r, 0); got != "2001:db8::7" {
		t.Fatalf("got %q", got)
	}
}

func TestPeerIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.1:1234"
	if got := PeerIP(r, 2); got != "192.0.2.1" {
		t.Fatalf("no header: got %q", got)
	}
	// A direct request to Cloud Run with a forged header: Cloud Run appends the real address.
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.7")
	if got := PeerIP(r, 2); got != "198.51.100.7" {
		t.Fatalf("got %q, want the rightmost entry", got)
	}
	if got := PeerIP(r, 0); got != "192.0.2.1" {
		t.Fatalf("hops=0: got %q, want remote addr", got)
	}
	r.Header.Set("X-Forwarded-For", "6.6.6.6, garbage")
	if got := PeerIP(r, 2); got != "192.0.2.1" {
		t.Fatalf("junk peer: got %q, want remote addr", got)
	}
}

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter(1, 2)
	if first, second := rl.Allow("a"), rl.Allow("a"); !first || !second {
		t.Fatal("burst should be allowed")
	}
	if rl.Allow("a") {
		t.Fatal("third request should be limited")
	}
	if !rl.Allow("b") {
		t.Fatal("other keys are independent")
	}
}

func TestRateLimiterBoundsMemory(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	for i := range maxKeys {
		rl.Allow(strings.Repeat("k", 20) + string(rune('a'+i%26)) + itoa(i))
	}
	if rl.Len() != maxKeys {
		t.Fatalf("len = %d, want %d", rl.Len(), maxKeys)
	}
	// One more distinct key resets the map rather than growing it.
	rl.Allow("overflow")
	if rl.Len() != 1 {
		t.Fatalf("len after overflow = %d, want 1", rl.Len())
	}

	// Idle keys are swept once the map is above sweepAbove and a sweep is due.
	rl = NewRateLimiter(1, 1)
	for i := range sweepAbove + 1 {
		rl.Allow(itoa(i))
	}
	rl.mu.Lock()
	for _, e := range rl.limiters {
		e.seen = time.Now().Add(-2 * idleAfter)
	}
	rl.lastSweep = time.Now().Add(-2 * sweepEvery)
	rl.mu.Unlock()
	rl.Allow("fresh")
	if rl.Len() != 1 {
		t.Fatalf("len after sweep = %d, want 1", rl.Len())
	}

	// Oversized keys are truncated so a caller cannot store arbitrary data.
	rl.Allow(strings.Repeat("x", 100_000))
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for k := range rl.limiters {
		if len(k) > maxKeyLen {
			t.Fatalf("key of %d bytes stored", len(k))
		}
	}
}

func itoa(i int) string {
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

func TestReadJSON(t *testing.T) {
	type body struct {
		Name string `json:"name"`
	}
	cases := map[string]struct {
		ct, in  string
		wantErr string
	}{
		"ok":                 {"application/json", `{"name":"x"}`, ""},
		"charset parameter":  {"application/json; charset=utf-8", `{"name":"x"}`, ""},
		"form content type":  {"application/x-www-form-urlencoded", `{"name":"x"}`, "content type"},
		"missing type":       {"", `{"name":"x"}`, "content type"},
		"unknown field":      {"application/json", `{"name":"x","evil":1}`, "unknown field"},
		"trailing data":      {"application/json", `{"name":"x"} {"name":"y"}`, "unexpected data"},
		"trailing garbage":   {"application/json", `{"name":"x"} garbage`, "unexpected data"},
		"too large":          {"application/json", `{"name":"` + strings.Repeat("x", MaxJSONBody) + `"}`, "too large"},
		"empty body":         {"application/json", ``, "EOF"},
		"wrong type for key": {"application/json", `{"name":1}`, "cannot unmarshal"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(c.in))
			if c.ct != "" {
				r.Header.Set("Content-Type", c.ct)
			}
			var v body
			err := ReadJSON(httptest.NewRecorder(), r, &v)
			if c.wantErr == "" {
				if err != nil || v.Name != "x" {
					t.Fatalf("got %+v, %v", v, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("err = %v, want %q", err, c.wantErr)
			}
		})
	}
}

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	Error(w, http.StatusTeapot, "short and stout")
	if w.Code != http.StatusTeapot || w.Header().Get("Cache-Control") != "no-store" ||
		w.Header().Get("Content-Type") != "application/json" || w.Body.String() != `{"error":"short and stout"}`+"\n" {
		t.Fatalf("got %d %v %q", w.Code, w.Header(), w.Body)
	}
}
