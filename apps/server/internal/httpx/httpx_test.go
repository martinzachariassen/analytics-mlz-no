package httpx

import (
	"net/http/httptest"
	"testing"
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
		{"no header falls back", "", 1, "192.0.2.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
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
