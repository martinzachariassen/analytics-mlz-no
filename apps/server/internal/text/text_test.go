package text

import "testing"

func TestClean(t *testing.T) {
	for in, want := range map[string]string{
		"sign\nup":                       "signup",
		"a\u202eb":                       "ab",
		"bad\xffutf8":                    "badutf8",
		"\U0001F469\u200d\U0001F4BB dev": "\U0001F469\u200d\U0001F4BB dev",
	} {
		if got := Clean(in); got != want {
			t.Errorf("Clean(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTruncateKeepsRunesWhole(t *testing.T) {
	if got := Truncate("abc", 5); got != "abc" {
		t.Errorf("short string changed: %q", got)
	}
	if got := Truncate("aøb", 2); got != "a" {
		t.Errorf("Truncate split a rune: %q", got)
	}
}
