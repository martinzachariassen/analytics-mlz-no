package store

import "testing"

// FuzzNormalizeDomain checks that a normalised domain is either rejected ("") or valid, and
// that normalising it again changes nothing.
func FuzzNormalizeDomain(f *testing.F) {
	for _, s := range []string{"https://www.Example.com/", "ÆRØ.NO", "blog.mlz.no:8080/x", "a_b.c", "<b>.x.com", "xn--", ".", "localhost"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, in string) {
		d := NormalizeDomain(in)
		if d == "" {
			return
		}
		if !validDomain(d) {
			t.Fatalf("NormalizeDomain(%q) = %q, which is not a valid domain", in, d)
		}
		if again := NormalizeDomain(d); again != d {
			t.Fatalf("not idempotent: %q -> %q -> %q", in, d, again)
		}
	})
}
