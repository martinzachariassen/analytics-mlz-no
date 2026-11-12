// Package text cleans strings that come from browsers before they are stored, so ingest and
// everything that must match stored values (goals) agree on what a value looks like.
package text

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Clean drops invalid UTF-8, control characters (newlines, NUL, escapes) and bidi
// overrides, so stored strings are safe to log and cannot reorder text in the dashboard.
// Zero-width joiners stay, since emoji sequences use them.
func Clean(s string) string {
	s = strings.ToValidUTF8(s, "")
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) {
			return -1
		}
		return r
	}, s)
}

// Truncate cuts s to at most n bytes without splitting a UTF-8 sequence.
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
