package visitor

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeSalts struct {
	calls int
	err   error
}

func (f *fakeSalts) SaltForDay(_ context.Context, day string) ([]byte, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return []byte("salt-for-" + day), nil
}

func TestIDIsDeterministicPerDayAndSite(t *testing.T) {
	ctx := context.Background()
	salts := &fakeSalts{}
	h := NewHasher(salts)
	now := time.Date(2026, 11, 4, 23, 59, 0, 0, time.UTC)
	h.now = func() time.Time { return now }

	a, _ := h.ID(ctx, "site1", "192.0.2.1", "Mozilla/5.0")
	b, _ := h.ID(ctx, "site1", "192.0.2.1", "Mozilla/5.0")
	if a != b {
		t.Fatal("same inputs on the same day must give the same id")
	}
	if a < 0 {
		t.Fatal("id must be non-negative (63 bits)")
	}
	if salts.calls != 1 {
		t.Fatalf("salt fetched %d times, want 1 (cached per day)", salts.calls)
	}

	otherSite, _ := h.ID(ctx, "site2", "192.0.2.1", "Mozilla/5.0")
	otherIP, _ := h.ID(ctx, "site1", "192.0.2.2", "Mozilla/5.0")
	otherUA, _ := h.ID(ctx, "site1", "192.0.2.1", "curl/8")
	for name, other := range map[string]int64{"site": otherSite, "ip": otherIP, "ua": otherUA} {
		if other == a {
			t.Errorf("changing the %s must change the id", name)
		}
	}

	// Midnight UTC: new salt, new id for the same person.
	now = now.Add(2 * time.Minute)
	c, _ := h.ID(ctx, "site1", "192.0.2.1", "Mozilla/5.0")
	if c == a {
		t.Fatal("the id must change when the day (and salt) changes")
	}
	if salts.calls != 2 {
		t.Fatalf("salt fetched %d times, want 2", salts.calls)
	}
}

func TestIDSeparatesFields(t *testing.T) {
	// "ab"+"c" and "a"+"bc" must not collide: fields are delimited in the hash input.
	ctx := context.Background()
	h := NewHasher(&fakeSalts{})
	x, _ := h.ID(ctx, "ab", "c", "ua")
	y, _ := h.ID(ctx, "a", "bc", "ua")
	if x == y {
		t.Fatal("field boundaries are not part of the hash")
	}
}

func TestIDPropagatesSaltErrors(t *testing.T) {
	boom := errors.New("db down")
	h := NewHasher(&fakeSalts{err: boom})
	if _, err := h.ID(context.Background(), "s", "ip", "ua"); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want %v", err, boom)
	}
}
