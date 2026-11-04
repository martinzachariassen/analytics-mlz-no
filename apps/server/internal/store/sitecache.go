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

func (c *siteCache) put(id string, site Site, found bool, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
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
}
