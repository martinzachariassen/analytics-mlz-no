package ingest

import (
	"regexp"
	"strings"
)

// imageProxy is a service that fetches images on behalf of its users, so a pixel request
// from it carries the proxy's address and user agent instead of the reader's.
type imageProxy struct {
	match  func(ua string) bool
	source string // the site whose readers it serves, stored as the referrer
}

// Camo sends exactly "github-camo (<hex>)"; anything around it is someone else.
var camoPattern = regexp.MustCompile(`^github-camo \([0-9a-f]+\)$`)

var imageProxies = []imageProxy{
	{camoPattern.MatchString, "github.com"},
	{func(ua string) bool { return strings.Contains(ua, "GoogleImageProxy") }, "mail.google.com"},
	// The user agent parser calls it a bot (it carries a URL), so only botMarkers decide here.
	{func(ua string) bool { return strings.HasPrefix(ua, "YahooMailProxy") }, "mail.yahoo.com"},
}

// matchProxy returns the image proxy that sent a request with this user agent, if any.
// The match is strict and a user agent with a bot marker (curl, python-requests, …) never
// counts, but anyone can still send a proxy's exact user agent. What that gains: the event
// is stored without dimensions and skips the bot check and the per-visitor limit, while the
// address limits still apply. Rotating user agents defeats the per-visitor limit anyway.
func matchProxy(ua string) (imageProxy, bool) {
	if hasBotMarker(strings.ToLower(ua)) {
		return imageProxy{}, false
	}
	for _, p := range imageProxies {
		if p.match(ua) {
			return p, true
		}
	}
	return imageProxy{}, false
}
