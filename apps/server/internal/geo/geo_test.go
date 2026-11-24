package geo

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestDisabledLocator(t *testing.T) {
	loc, err := Open("")
	if err != nil || loc.Enabled() {
		t.Fatalf("Open(\"\") = %v, %v", loc, err)
	}
	if got := loc.Country("8.8.8.8"); got != "" {
		t.Fatalf("Country = %q, want empty", got)
	}
	var nilLoc *Locator
	if nilLoc.Enabled() || nilLoc.Country("8.8.8.8") != "" || nilLoc.Close() != nil {
		t.Fatal("a nil Locator must be a safe no-op")
	}
	if err := loc.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenRejectsBadFiles(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "missing.mmdb")); err == nil {
		t.Fatal("missing file must fail")
	}
	bad := filepath.Join(t.TempDir(), "bad.mmdb")
	if err := os.WriteFile(bad, []byte("not a database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(bad); err == nil {
		t.Fatal("corrupt file must fail")
	}
}

// writeTestDB writes a minimal MaxMind DB (IPv4 tree, 24-bit records) in which 8.8.8.0/24
// maps to {"country": {"iso_code": "US"}} and everything else is unknown.
func writeTestDB(t *testing.T) string {
	t.Helper()
	const nodeCount = 24
	// A chain of 24 nodes follows the first 24 bits of 8.8.8.x; every other branch is "no data"
	// (record value == nodeCount) and the end of the chain points into the data section.
	const bits = 0x080808 // 8.8.8
	var tree []byte
	rec := func(v int) []byte { return []byte{byte(v >> 16), byte(v >> 8), byte(v)} }
	for i := range nodeCount {
		bit := bits >> (23 - i) & 1
		next := i + 1
		if i == nodeCount-1 {
			next = nodeCount + 16 // data offset 0 after the 16-byte separator
		}
		left, right := rec(nodeCount), rec(nodeCount)
		if bit == 0 {
			left = rec(next)
		} else {
			right = rec(next)
		}
		tree = append(tree, left...)
		tree = append(tree, right...)
	}
	str := func(v string) []byte { return append([]byte{0x40 | byte(len(v))}, v...) }
	mapOf := func(n int, kv ...[]byte) []byte {
		out := []byte{0xE0 | byte(n)}
		for _, b := range kv {
			out = append(out, b...)
		}
		return out
	}
	data := mapOf(1, str("country"), mapOf(1, str("iso_code"), str("US")))
	uint16Val := func(v int) []byte { return []byte{0xA2, byte(v >> 8), byte(v)} }
	uint32Val := func(v int) []byte { return []byte{0xC4, byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)} }
	meta := mapOf(5,
		str("node_count"), uint32Val(nodeCount),
		str("record_size"), uint16Val(24),
		str("ip_version"), uint16Val(4),
		str("binary_format_major_version"), uint16Val(2),
		str("binary_format_minor_version"), uint16Val(0),
	)
	file := slices.Concat(tree, make([]byte, 16), data)
	file = append(file, "\xab\xcd\xefMaxMind.com"...)
	file = append(file, meta...)
	path := filepath.Join(t.TempDir(), "test.mmdb")
	if err := os.WriteFile(path, file, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestLookup runs against a tiny generated database, so it needs no external file.
func TestLookup(t *testing.T) {
	loc, err := Open(writeTestDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = loc.Close() }()
	if !loc.Enabled() {
		t.Fatal("a loaded database must be enabled")
	}
	for _, ip := range []string{"not an ip", "", "::1", "127.0.0.1", "8.8.9.1", "1.1.1.1"} {
		if got := loc.Country(ip); got != "" {
			t.Errorf("Country(%q) = %q, want empty", ip, got)
		}
	}
	for _, ip := range []string{"8.8.8.8", "8.8.8.255", "::ffff:8.8.8.8"} {
		if got := loc.Country(ip); got != "US" {
			t.Errorf("Country(%q) = %q, want US", ip, got)
		}
	}
}
