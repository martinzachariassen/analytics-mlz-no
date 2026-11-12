package httpx

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

// FuzzClientIP checks that ClientIP and PeerIP only ever return a parsed, canonical address
// or the raw RemoteAddr, never text taken from a header, whatever X-Forwarded-For holds.
func FuzzClientIP(f *testing.F) {
	f.Add("203.0.113.7, 10.0.0.1", "10.0.0.2:4711", 2)
	f.Add("[2001:db8::1]:443, ::ffff:198.51.100.1", "[::1]:80", 1)
	f.Add("<script>, , ,fe80::1%eth0", "not-an-address", 3)
	f.Add("", "192.0.2.1:1", 0)

	f.Fuzz(func(t *testing.T, xff, remote string, hops int) {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		r.Header.Set("X-Forwarded-For", xff)
		hops %= 8
		if hops < 0 {
			hops = -hops
		}
		for _, got := range []string{ClientIP(r, hops), PeerIP(r, hops)} {
			if got == remote {
				continue
			}
			a, err := netip.ParseAddr(got)
			if err != nil || a.String() != got || a.Is4In6() || a.Zone() != "" {
				t.Fatalf("got %q (xff %q, remote %q, hops %d)", got, xff, remote, hops)
			}
		}
	})
}
