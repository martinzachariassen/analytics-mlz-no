package geo

import (
	"os"
	"path/filepath"
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

// TestLookup runs against a real database when GEOIP_DB_PATH points at one (the Docker
// image ships DB-IP Lite); it is skipped otherwise.
func TestLookup(t *testing.T) {
	path := os.Getenv("GEOIP_DB_PATH")
	if path == "" {
		t.Skip("GEOIP_DB_PATH not set")
	}
	loc, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = loc.Close() }()
	for _, ip := range []string{"not an ip", "", "::1", "127.0.0.1"} {
		if got := loc.Country(ip); got != "" {
			t.Errorf("Country(%q) = %q, want empty", ip, got)
		}
	}
	plain, mapped := loc.Country("8.8.8.8"), loc.Country("::ffff:8.8.8.8")
	if plain == "" || plain != mapped {
		t.Fatalf("8.8.8.8 = %q, mapped = %q", plain, mapped)
	}
}
