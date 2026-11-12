package ingest

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

// FuzzEvent sends arbitrary payloads and checks that whatever is stored stays within the
// limits and belongs to the site, whatever the browser sent.
func FuzzEvent(f *testing.F) {
	f.Add("https://example.com/a?utm_source=X", "https://google.com/", "pageview", "", `{}`, "https://example.com")
	f.Add("https://blog.example.com/#/route", "", "event", "signup", `{"plan":"pro","n":3,"ok":true}`, "null")
	f.Add("https://example.com/", "", "event", "outbound-link", `{"url":"https://u:p@x.org/p?q=1#f"}`, "https://example.com")
	f.Add("https://evil.com/", "javascript:alert(1)", "event", "\u202e\x00x", `{"\n":"\x1b"}`, "https://example.com.evil.com")
	f.Add("http://EXAMPLE.com./%2e%2e/", "//example.com", "", "", `[]`, "")

	h, rec, site := setup(f)
	f.Fuzz(func(t *testing.T, pageURL, referrer, typ, name, props, origin string) {
		body, err := json.Marshal(map[string]any{
			"site": site.ID, "url": pageURL, "referrer": referrer, "type": typ, "name": name,
			"props": json.RawMessage(props),
		})
		if err != nil {
			body = []byte(`{"site":"` + site.ID + `","url":` + mustJSON(pageURL) + `}`)
		}
		rec.events = rec.events[:0]
		w := post(h, string(body), chromeUA, origin)
		if w.Code != http.StatusAccepted && w.Code != http.StatusBadRequest && w.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status %d for %s", w.Code, body)
		}
		for _, e := range rec.events {
			if !validHostname(e.Hostname) || !hostMatches(e.Hostname, site.Domain) {
				t.Fatalf("stored hostname %q for site %q", e.Hostname, site.Domain)
			}
			if e.ReferrerHost != "" && (!validHostname(e.ReferrerHost) || hostMatches(e.ReferrerHost, site.Domain)) {
				t.Fatalf("stored referrer %q", e.ReferrerHost)
			}
			if e.Type != "pageview" && e.Type != "event" {
				t.Fatalf("stored type %q", e.Type)
			}
			checkText(t, "path", e.Path, maxPathLen)
			checkText(t, "name", e.Name, maxNameLen)
			for _, v := range []string{e.UTMSource, e.UTMMedium, e.UTMCampaign} {
				checkText(t, "utm", v, maxPropValLen)
			}
			if len(e.Props) > maxProps {
				t.Fatalf("%d props stored", len(e.Props))
			}
			for k, v := range e.Props {
				checkText(t, "prop key", k, maxPropKeyLen)
				checkText(t, "prop value", v, maxPropValLen)
			}
		}
	})
}

func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// checkText asserts a stored string is valid UTF-8, at most n bytes, and free of control
// characters and bidi overrides.
func checkText(t *testing.T, field, s string, n int) {
	t.Helper()
	if len(s) > n || !utf8.ValidString(s) {
		t.Fatalf("%s %q: %d bytes or invalid UTF-8", field, s, len(s))
	}
	if strings.ContainsFunc(s, func(r rune) bool {
		return unicode.IsControl(r) || (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069)
	}) {
		t.Fatalf("%s %q contains control or bidi characters", field, s)
	}
}
