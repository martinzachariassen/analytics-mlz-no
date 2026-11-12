package store

import (
	"testing"
	"time"
)

func TestSiteCacheExpiresAndBounds(t *testing.T) {
	var c siteCache
	t0 := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)

	c.put("a", Site{ID: "a"}, true, t0)
	c.put("missing", Site{}, false, t0)
	if s, found, ok := c.get("a", t0.Add(time.Second)); !ok || !found || s.ID != "a" {
		t.Fatalf("get a = %+v, %v, %v", s, found, ok)
	}
	if _, found, ok := c.get("missing", t0.Add(time.Second)); !ok || found {
		t.Fatalf("negative entry: found=%v ok=%v", found, ok)
	}
	if _, _, ok := c.get("a", t0.Add(siteCacheTTL+time.Second)); ok {
		t.Fatal("entry should have expired")
	}
	if _, _, ok := c.get("never", t0); ok {
		t.Fatal("unknown key reported as cached")
	}

	c = siteCache{}
	for i := range siteCacheMax {
		c.put(itoa(i), Site{}, false, t0)
	}
	if len(c.entries) != siteCacheMax {
		t.Fatalf("len = %d, want %d", len(c.entries), siteCacheMax)
	}
	c.put("one more", Site{}, false, t0)
	if len(c.entries) != 1 {
		t.Fatalf("len after overflow = %d, want 1 (reset)", len(c.entries))
	}
	c.clear()
	if _, _, ok := c.get("one more", t0); ok {
		t.Fatal("clear did not clear")
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
