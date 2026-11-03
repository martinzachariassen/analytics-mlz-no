// Package visitor computes anonymous, daily-rotating visitor identifiers.
//
// The id is a hash of a secret daily salt, the site id, the client IP and the
// user agent. The salt is replaced every UTC day and the previous one deleted,
// so the same person cannot be linked across days and the IP can never be
// recovered from stored data.
package visitor

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"sync"
	"time"
)

// SaltSource provides the salt for a given day (YYYY-MM-DD).
type SaltSource interface {
	SaltForDay(ctx context.Context, day string) ([]byte, error)
}

// Hasher computes visitor ids, caching the current day's salt.
type Hasher struct {
	src SaltSource
	now func() time.Time

	mu   sync.Mutex
	day  string
	salt []byte
}

// NewHasher returns a Hasher backed by src.
func NewHasher(src SaltSource) *Hasher {
	return &Hasher{src: src, now: time.Now}
}

// ID returns the visitor id for the given site, IP and user agent.
func (h *Hasher) ID(ctx context.Context, siteID, ip, userAgent string) (int64, error) {
	salt, err := h.currentSalt(ctx)
	if err != nil {
		return 0, err
	}
	sum := sha256.New()
	sum.Write(salt)
	for _, part := range []string{siteID, ip, userAgent} {
		sum.Write([]byte(part))
		sum.Write([]byte{0})
	}
	b := sum.Sum(nil)
	return int64(binary.BigEndian.Uint64(b[:8]) >> 1), nil
}

func (h *Hasher) currentSalt(ctx context.Context) ([]byte, error) {
	day := h.now().UTC().Format(time.DateOnly)

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.day == day {
		return h.salt, nil
	}
	salt, err := h.src.SaltForDay(ctx, day)
	if err != nil {
		return nil, err
	}
	h.day, h.salt = day, salt
	return salt, nil
}
