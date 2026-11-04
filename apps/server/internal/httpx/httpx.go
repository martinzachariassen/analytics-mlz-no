// Package httpx contains small HTTP helpers: client IP extraction, JSON and per-IP rate limiting.
package httpx

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ClientIP returns the client's IP address in canonical form.
//
// With proxyHops == 0 the TCP remote address is used. With proxyHops == n the
// n-th entry from the right of X-Forwarded-For is used, i.e. the address the
// outermost trusted proxy saw. Entries further left are client-controlled and
// ignored. Examples: Cloud Run directly = 1, Firebase Hosting -> Cloud Run = 2.
//
// If a request bypasses one of the proxies (for example a direct request to the
// run.app URL when Firebase Hosting is expected in front), the entry ClientIP
// picks can be client-controlled. Callers that rate limit should also limit by
// PeerIP, which cannot be spoofed. An entry that is not an IP address is never
// returned: the result is always a parsed address, so it is safe as a map key.
func ClientIP(r *http.Request, proxyHops int) string {
	if proxyHops > 0 {
		if hops := forwardedFor(r); len(hops) > 0 {
			i := len(hops) - proxyHops
			if i < 0 {
				// Fewer entries than expected: never fall back to a client-controlled
				// entry, use what the nearest proxy saw.
				i = len(hops) - 1
			}
			if ip, ok := parseIP(hops[i]); ok {
				return ip
			}
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
			if ip, ok := parseIP(hops[len(hops)-1]); ok {
				return ip
			}
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

// parseIP canonicalises an address from a header: IPv4-mapped IPv6 becomes IPv4, zones and
// ports are dropped, and anything that is not an address is rejected.
func parseIP(s string) (string, bool) {
	if h, _, err := net.SplitHostPort(s); err == nil {
		s = h
	}
	s = strings.TrimSuffix(strings.TrimPrefix(s, "["), "]")
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return "", false
	}
	return addr.Unmap().WithZone("").String(), true
}

func remoteHost(r *http.Request) string {
	if ip, ok := parseIP(r.RemoteAddr); ok {
		return ip
	}
	return r.RemoteAddr
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
// Keys are capped in length so a caller cannot pass arbitrarily large strings.
const (
	sweepAbove = 10_000
	sweepEvery = time.Minute
	idleAfter  = 10 * time.Minute
	maxKeys    = 200_000
	maxKeyLen  = 128
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
	if len(key) > maxKeyLen {
		key = key[:maxKeyLen]
	}
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

// Len returns the number of tracked keys.
func (rl *RateLimiter) Len() int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return len(rl.limiters)
}
