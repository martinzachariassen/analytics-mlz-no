package store

import (
	"sync"
	"time"
)

// Site lookups happen on every ingested event. A small in-memory cache keeps junk traffic
// (unknown or repeated site ids) off the database. Site changes made through this Store
// clear it at once; changes from another process (the `sites` CLI) show up within siteCacheTTL.
const (
	siteCacheTTL = time.Minute
	siteCacheMax = 10_000
)

type siteCache struct {
	mu      sync.Mutex
	entries map[string]siteCacheEntry
	// gen counts clears. A lookup that started before a clear may have read the old row, so
	// put drops its result.
	gen uint64
}

type siteCacheEntry struct {
	site    Site
	found   bool
	expires time.Time
}

func (c *siteCache) get(id string, now time.Time) (Site, bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[id]
	if !ok || now.After(e.expires) {
		return Site{}, false, false
	}
	return e.site, e.found, true
}

// generation is read before a lookup and passed to put.
func (c *siteCache) generation() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gen
}

func (c *siteCache) put(id string, site Site, found bool, now time.Time, gen uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen {
		return
	}
	if c.entries == nil || len(c.entries) >= siteCacheMax {
		// Bounded memory: random ids from a flood fill the cache, so start over.
		c.entries = make(map[string]siteCacheEntry)
	}
	c.entries[id] = siteCacheEntry{site: site, found: found, expires: now.Add(siteCacheTTL)}
}

func (c *siteCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = nil
	c.gen++
}
