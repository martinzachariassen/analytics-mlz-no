package server

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// sizeGuard reports whether the database is over its size limit. The size is read at most
// once per interval, inline on the request that notices the value is stale, so there is no
// background goroutine and a flood of requests costs one cheap PRAGMA per interval.
type sizeGuard struct {
	size     func(context.Context) (int64, error)
	max      int64
	interval time.Duration
	log      *slog.Logger

	mu      sync.Mutex
	checked time.Time
	over    bool
}

func (g *sizeGuard) Paused() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if now := time.Now(); now.Sub(g.checked) >= g.interval {
		g.checked = now
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		n, err := g.size(ctx)
		cancel()
		if err != nil {
			g.log.Error("database size check", "err", err)
			return g.over // keep the last known state
		}
		over := n > g.max
		if over && !g.over {
			g.log.Error("database is over MAX_DATABASE_MB; ingestion paused", "bytes", n, "max_bytes", g.max)
		} else if !over && g.over {
			g.log.Info("database is under MAX_DATABASE_MB again; ingestion resumed", "bytes", n)
		}
		g.over = over
	}
	return g.over
}
