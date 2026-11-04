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
//
// If a request bypasses one of the proxies (for example a direct request to the
// run.app URL when Firebase Hosting is expected in front), the entry ClientIP
// picks can be client-controlled. Callers that rate limit should also limit by
// PeerIP, which cannot be spoofed.
func ClientIP(r *http.Request, proxyHops int) string {
	if proxyHops > 0 {
		if hops := forwardedFor(r); len(hops) > 0 {
			i := len(hops) - proxyHops
			if i < 0 {
				// Fewer entries than expected: never fall back to a client-controlled
				// entry, use what the nearest proxy saw.
				i = len(hops) - 1
			}
			return hops[i]
		}
	}
	return remoteHost(r)
}

// PeerIP returns the address that connected to the nearest trusted proxy: the
// rightmost X-Forwarded-For entry when proxyHops > 0, otherwise the TCP remote
// address. Clients cannot forge it. Behind a CDN it is the CDN's edge address,
// so it is only suitable as a coarse, generous rate-limit key.
func PeerIP(r *http.Request, proxyHops int) string {
	if proxyHops > 0 {
		if hops := forwardedFor(r); len(hops) > 0 {
			return hops[len(hops)-1]
		}
	}
	return remoteHost(r)
}

func forwardedFor(r *http.Request) []string {
	var hops []string
	for _, h := range r.Header.Values("X-Forwarded-For") {
		for _, p := range strings.Split(h, ",") {
			if p = strings.TrimSpace(p); p != "" {
				hops = append(hops, p)
			}
		}
	}
	return hops
}

func remoteHost(r *http.Request) string {
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

	mu        sync.Mutex
	limiters  map[string]*entry
	lastSweep time.Time
}

// Memory bounds for RateLimiter. Idle keys are swept at most once per sweepEvery once the
// map passes sweepAbove; if a flood of distinct keys pushes it past maxKeys anyway, it is
// reset, which briefly forgives everyone rather than letting memory grow without bound.
const (
	sweepAbove = 10_000
	sweepEvery = time.Minute
	idleAfter  = 10 * time.Minute
	maxKeys    = 200_000
)

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
		if len(rl.limiters) > sweepAbove && now.Sub(rl.lastSweep) > sweepEvery {
			rl.lastSweep = now
			for k, v := range rl.limiters {
				if now.Sub(v.seen) > idleAfter {
					delete(rl.limiters, k)
				}
			}
		}
		if len(rl.limiters) >= maxKeys {
			rl.limiters = map[string]*entry{}
		}
		e = &entry{lim: rate.NewLimiter(rl.rate, rl.burst)}
		rl.limiters[key] = e
	}
	e.seen = now
	return e.lim.Allow()
}
