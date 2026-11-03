// Package httpx contains small HTTP helpers: client IP extraction and per-IP rate limiting.
package httpx

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ClientIP returns the client's IP address.
//
// With proxyHops == 0 the TCP remote address is used. With proxyHops == n the
// n-th entry from the right of X-Forwarded-For is used, i.e. the address the
// outermost trusted proxy saw. Entries further left are client-controlled and
// ignored. Examples: Cloud Run directly = 1, Firebase Hosting -> Cloud Run = 2.
func ClientIP(r *http.Request, proxyHops int) string {
	if proxyHops > 0 {
		var hops []string
		for _, h := range r.Header.Values("X-Forwarded-For") {
			for _, p := range strings.Split(h, ",") {
				if p = strings.TrimSpace(p); p != "" {
					hops = append(hops, p)
				}
			}
		}
		if len(hops) > 0 {
			i := len(hops) - proxyHops
			if i < 0 {
				i = 0
			}
			return hops[i]
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimiter limits requests per key (typically client IP).
type RateLimiter struct {
	rate  rate.Limit
	burst int

	mu       sync.Mutex
	limiters map[string]*entry
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

// NewRateLimiter allows perSecond requests per key with the given burst.
func NewRateLimiter(perSecond float64, burst int) *RateLimiter {
	return &RateLimiter{rate: rate.Limit(perSecond), burst: burst, limiters: map[string]*entry{}}
}

// Allow reports whether a request for key may proceed.
func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	e, ok := rl.limiters[key]
	if !ok {
		// Opportunistic cleanup keeps memory bounded without a background goroutine.
		if len(rl.limiters) > 10_000 {
			for k, v := range rl.limiters {
				if now.Sub(v.seen) > 10*time.Minute {
					delete(rl.limiters, k)
				}
			}
		}
		e = &entry{lim: rate.NewLimiter(rl.rate, rl.burst)}
		rl.limiters[key] = e
	}
	e.seen = now
	return e.lim.Allow()
}
