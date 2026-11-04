// Command loadtest sends synthetic page views to a running server and reports throughput and
// latency. It is a development tool for sizing a single SQLite-backed instance, not part of the
// product.
//
//	go run ./dev/loadtest -url http://localhost:8080 -site <site-id> -domain example.com \
//	    -concurrency 32 -duration 15s
//
// The server rate-limits per client IP (10 requests/s). To measure ingestion rather than the
// limiter, start the server with PROXY_HOPS=1 and pass -vary-ip, which sends a different
// X-Forwarded-For on every request.
//
// Use a throwaway database (for example `make dev-reset` first): it writes real events.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"math/rand/v2"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

func main() {
	base := flag.String("url", "http://localhost:8080", "server base URL")
	site := flag.String("site", "", "site id (see `analytics sites list`)")
	domain := flag.String("domain", "example.com", "the site's registered domain")
	conc := flag.Int("concurrency", 32, "parallel clients")
	dur := flag.Duration("duration", 15*time.Second, "how long to run")
	varyIP := flag.Bool("vary-ip", false, "send a random X-Forwarded-For per request (server needs PROXY_HOPS=1)")
	flag.Parse()
	if *site == "" {
		fmt.Fprintln(os.Stderr, "-site is required")
		os.Exit(2)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	deadline := time.Now().Add(*dur)

	var mu sync.Mutex
	var lat []time.Duration
	var failures, limited int

	var wg sync.WaitGroup
	for w := 0; w < *conc; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			var local []time.Duration
			var fail, lim int
			for i := 0; time.Now().Before(deadline); i++ {
				body := fmt.Sprintf(`{"site":%q,"url":"https://%s/page-%d"}`, *site, *domain, (w*7919+i)%200)
				req, _ := http.NewRequest(http.MethodPost, *base+"/api/event", bytes.NewBufferString(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0")
				if *varyIP {
					req.Header.Set("X-Forwarded-For", fmt.Sprintf("10.%d.%d.%d", rand.IntN(256), rand.IntN(256), 1+rand.IntN(254))) //nolint:gosec // test traffic, not security-sensitive
				}
				start := time.Now()
				resp, err := client.Do(req)
				if err != nil {
					fail++
					continue
				}
				_ = resp.Body.Close()
				switch {
				case resp.StatusCode == http.StatusTooManyRequests:
					lim++
				case resp.StatusCode >= 300:
					fail++
				default:
					local = append(local, time.Since(start))
				}
			}
			mu.Lock()
			lat = append(lat, local...)
			failures += fail
			limited += lim
			mu.Unlock()
		}(w)
	}
	wg.Wait()

	if len(lat) == 0 {
		fmt.Printf("no successful requests (failures: %d, rate limited: %d)\n", failures, limited)
		os.Exit(1)
	}
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	pct := func(p float64) time.Duration { return lat[int(float64(len(lat)-1)*p)] }
	fmt.Printf("requests:      %d ok, %d failed, %d rate limited\n", len(lat), failures, limited)
	fmt.Printf("throughput:    %.0f events/s\n", float64(len(lat))/dur.Seconds())
	fmt.Printf("latency:       p50 %v  p95 %v  p99 %v  max %v\n", pct(0.50), pct(0.95), pct(0.99), lat[len(lat)-1])
}
