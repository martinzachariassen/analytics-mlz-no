package ingest

import (
	"bytes"
	"context"
	"image/gif"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"golang.org/x/time/rate"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

const camoUA = "github-camo (876de43e)"

func pixelSetup(t *testing.T) (http.Handler, *recordingStore, store.Site) {
	t.Helper()
	h, rec, site := setup(t)
	site, err := rec.SetSitePixel(context.Background(), site.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	return h.Pixel(), rec, site
}

func pixel(h http.Handler, method, query, ua string) *httptest.ResponseRecorder {
	return pixelWithReferer(h, method, query, ua, "")
}

func pixelWithReferer(h http.Handler, method, query, ua, referer string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/api/pixel.gif?"+query, nil)
	req.Header.Set("User-Agent", ua)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func assertGIF(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/gif" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q", cc)
	}
	img, err := gif.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("body is not a GIF: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 1 || b.Dy() != 1 {
		t.Errorf("image is %dx%d", b.Dx(), b.Dy())
	}
}

func TestPixelPageview(t *testing.T) {
	h, rec, site := pixelSetup(t)
	q := url.Values{"site": {site.ID}, "p": {"/readme?secret=1#top"}, "utm_source": {"GitHub"}, "utm_campaign": {"Profile"}, "ref": {"news.ycombinator.com"}}
	w := pixel(h, http.MethodGet, q.Encode(), chromeUA)
	assertGIF(t, w)
	if len(rec.events) != 1 {
		t.Fatalf("got %d events", len(rec.events))
	}
	e := rec.events[0]
	for name, c := range map[string][2]string{
		"type":     {e.Type, "pageview"},
		"hostname": {e.Hostname, "example.com"},
		"path":     {e.Path, "/readme"},
		"referrer": {e.ReferrerHost, "news.ycombinator.com"},
		"utm":      {e.UTMSource, "github"},
		"campaign": {e.UTMCampaign, "Profile"},
		"browser":  {e.Browser, "Chrome"},
		"device":   {e.Device, "desktop"},
	} {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}
	if e.VisitorID == 0 {
		t.Error("no visitor id")
	}
}

func TestPixelEvent(t *testing.T) {
	h, rec, site := pixelSetup(t)
	assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID+"&e=email-open", chromeUA))
	assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID+"&e=%20%20", chromeUA))
	if len(rec.events) != 1 {
		t.Fatalf("got %d events, want 1 (an empty name is rejected)", len(rec.events))
	}
	if e := rec.events[0]; e.Type != "event" || e.Name != "email-open" || e.Path != "/" {
		t.Fatalf("event = %+v", e)
	}
}

func TestPixelProxy(t *testing.T) {
	h, rec, site := pixelSetup(t)
	for i := 0; i < 100; i++ {
		assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID+"&p=/profile", camoUA))
	}
	assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID+"&ref=example.org", camoUA))
	if len(rec.events) != 101 {
		t.Fatalf("got %d events, want 101 (proxy traffic skips the per-visitor limit)", len(rec.events))
	}
	e := rec.events[0]
	if e.ReferrerHost != "github.com" || e.Browser != "" || e.OS != "" || e.Device != "" || e.Country != "" {
		t.Fatalf("event = %+v, want github.com and empty dimensions", e)
	}
	if got := rec.events[100].ReferrerHost; got != "example.org" {
		t.Errorf("explicit ref = %q, want it to win over the proxy", got)
	}
}

func TestPixelMailProxies(t *testing.T) {
	h, rec, site := pixelSetup(t)
	for ua, want := range map[string]string{
		"Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)": "mail.google.com",
		// The user agent parser flags this one as a bot; the proxy match must win.
		"YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html": "mail.yahoo.com",
	} {
		before := len(rec.events)
		assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID+"&e=email-open", ua))
		if len(rec.events) != before+1 {
			t.Fatalf("%q: no event stored", ua)
		}
		if e := rec.events[before]; e.ReferrerHost != want || e.Device != "" || e.Country != "" {
			t.Errorf("%q: event = %+v, want referrer %s and no dimensions", ua, e, want)
		}
	}
}

func TestPixelRejectsButStillAnswersWithImage(t *testing.T) {
	h, rec, site := setup(t) // pixel not enabled
	off := h.Pixel()
	assertGIF(t, pixel(off, http.MethodGet, "site="+site.ID, chromeUA))

	on, rec2, site2 := pixelSetup(t)
	for name, c := range map[string]struct{ query, ua string }{
		"unknown site": {"site=abcdefghijkm", chromeUA},
		"junk site":    {"site=<script>", chromeUA},
		"no site":      {"p=/", chromeUA},
		"bot":          {"site=" + site2.ID, "Googlebot/2.1"},
		"empty ua":     {"site=" + site2.ID, ""},
	} {
		t.Run(name, func(t *testing.T) { assertGIF(t, pixel(on, http.MethodGet, c.query, c.ua)) })
	}
	head := pixel(on, http.MethodHead, "site="+site2.ID, chromeUA)
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Type") != "image/gif" {
		t.Errorf("HEAD = %d, %d bytes, %q", head.Code, head.Body.Len(), head.Header().Get("Content-Type"))
	}
	if len(rec.events)+len(rec2.events) != 0 {
		t.Fatalf("stored %d events, want none", len(rec.events)+len(rec2.events))
	}
}

func TestPixelSharesLimits(t *testing.T) {
	hd, _, site := setup(t)
	if _, err := hd.Store.(*recordingStore).SetSitePixel(context.Background(), site.ID, true); err != nil {
		t.Fatal(err)
	}
	rec := hd.Store.(*recordingStore)
	h := hd.Pixel()
	query := "site=" + site.ID

	// Over a limit, the pixel is still an image (a broken one would show on the page), but
	// nothing is stored.
	hd.Limiter = httpx.NewRateLimiter(1, 1)
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	if len(rec.events) != 1 {
		t.Fatalf("client limit: stored %d events, want 1", len(rec.events))
	}
	hd.Limiter = nil

	hd.Global = rate.NewLimiter(0, 0)
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	hd.Global = nil

	hd.Paused = func() bool { return true }
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	hd.Paused = nil

	if len(rec.events) != 1 {
		t.Fatalf("stored %d events, want 1", len(rec.events))
	}
}

// Image proxies carry many readers from a few addresses, so they get ProxyLimiter instead of
// the per-client Limiter.
func TestPixelProxyLimiter(t *testing.T) {
	hd, _, site := setup(t)
	rec := hd.Store.(*recordingStore)
	if _, err := rec.SetSitePixel(context.Background(), site.ID, true); err != nil {
		t.Fatal(err)
	}
	h := hd.Pixel()
	query := "site=" + site.ID
	hd.Limiter = httpx.NewRateLimiter(1, 1)
	hd.ProxyLimiter = httpx.NewRateLimiter(1, 3)
	for i := 0; i < 5; i++ {
		assertGIF(t, pixel(h, http.MethodGet, query, camoUA))
	}
	if len(rec.events) != 3 {
		t.Fatalf("proxy: stored %d events, want 3 (the proxy limiter's burst)", len(rec.events))
	}
	// A browser from the same address is still held to the client limit.
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	assertGIF(t, pixel(h, http.MethodGet, query, chromeUA))
	if len(rec.events) != 4 {
		t.Fatalf("browser: stored %d events in total, want 4", len(rec.events))
	}
}

// A pixel left on a page after it was turned off keeps arriving; it must not log at Info.
func TestPixelDisabledLogsAtDebug(t *testing.T) {
	hd, _, site := setup(t)
	var buf bytes.Buffer
	hd.Log = slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	h := hd.Pixel()
	assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID, camoUA))
	assertGIF(t, pixel(h, http.MethodGet, "site=abcdefghijkm", chromeUA))
	if buf.Len() != 0 {
		t.Fatalf("logged at Info: %s", buf.String())
	}
}

func TestPixelForgedProxy(t *testing.T) {
	h, rec, site := pixelSetup(t)
	for _, ua := range []string{"curl/8.4.0 github-camo (abc)", "python-requests/2 GoogleImageProxy", "Go-http-client/1.1"} {
		assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID, ua))
	}
	if len(rec.events) != 0 {
		t.Fatalf("stored %d events from bots claiming to be a proxy", len(rec.events))
	}

	// Not Camo's exact shape: an ordinary visitor, with the per-visitor limit and no
	// proxy referrer.
	assertGIF(t, pixel(h, http.MethodGet, "site="+site.ID, "Mozilla/5.0 github-camo (abc) Chrome/120"))
	for _, e := range rec.events {
		if e.ReferrerHost == "github.com" {
			t.Fatalf("event %+v treated as a Camo request", e)
		}
	}
}

func TestPixelReferer(t *testing.T) {
	h, rec, site := pixelSetup(t)
	q := "site=" + site.ID
	for _, c := range []struct{ query, ua, referer, want string }{
		{q, chromeUA, "https://forum.example.org/t/1?token=x", "forum.example.org"},
		{q + "&ref=news.ycombinator.com", chromeUA + " a", "https://forum.example.org/", "news.ycombinator.com"},
		{q, chromeUA + " b", "https://blog.example.com/post", ""},
		{q, chromeUA + " x", "not a url", ""},
		{q, camoUA, "https://forum.example.org/", "github.com"},
		{q + "&ref=" + url.QueryEscape("https://www.Google.com/search?q=x"), chromeUA + " c", "", "google.com"},
		{q + "&ref=" + url.QueryEscape("https://blog.example.com/a"), chromeUA + " d", "", ""},
		{q + "&ref=" + url.QueryEscape("javascript://evil.example/"), chromeUA + " e", "https://forum.example.org/", "forum.example.org"},
		{q + "&ref=", chromeUA + " f", "https://forum.example.org/", "forum.example.org"},
	} {
		before := len(rec.events)
		assertGIF(t, pixelWithReferer(h, http.MethodGet, c.query, c.ua, c.referer))
		if len(rec.events) != before+1 {
			t.Fatalf("%q: no event stored", c.referer)
		}
		if got := rec.events[len(rec.events)-1].ReferrerHost; got != c.want {
			t.Errorf("Referer %q with %q: referrer = %q, want %q", c.referer, c.query, got, c.want)
		}
	}
}

func TestRefHost(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"news.ycombinator.com", "news.ycombinator.com"},
		{" news.ycombinator.com ", "news.ycombinator.com"},
		{"https://news.ycombinator.com/item?id=1", "news.ycombinator.com"},
		{"http://user:pw@forum.example.org:8080/x", "forum.example.org"},
		{"ftp://files.example.org/", ""},
		{"https://%zz", ""},
		{"", ""},
	} {
		if got := refHost(c.in); got != c.want {
			t.Errorf("refHost(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestPixelPath(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"", "/"},
		{"/", "/"},
		{"readme", "/readme"},
		{"/a/b?x=1", "/a/b"},
		{"/a#frag", "/a"},
		{"\t/a\u202e\x00", "/a"},
	} {
		if got := pixelPath(c.in); got != c.want {
			t.Errorf("pixelPath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
