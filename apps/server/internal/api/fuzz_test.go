package api

import (
	"strconv"
	"strings"
	"testing"
)

// FuzzCell checks the CSV injection guard: a cell that a spreadsheet would read as a formula
// always gets the leading apostrophe; the only unchanged values starting with a formula
// character are plain numbers.
func FuzzCell(f *testing.F) {
	for _, s := range []string{"=1+1", "-1", "+47 22 00 00 00", "@SUM(A1)", "-Inf", "-0x10", "\t=x", "/blog", ""} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		got := cell(s)
		if got != s {
			if got != "'"+s {
				t.Fatalf("cell(%q) = %q", s, got)
			}
			return
		}
		if s == "" || !strings.ContainsRune("=+-@\t\r", rune(s[0])) {
			return
		}
		if _, err := strconv.ParseFloat(s, 64); err != nil || strings.ContainsAny(s, "xXpPiInN_") {
			t.Fatalf("cell(%q) left a formula-like value unchanged", s)
		}
	})
}
