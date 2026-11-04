package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/httpx"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/visitor"
)

const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

type recordingStore struct {
	*store.Store
	events []store.Event
}

func (r *recordingStore) InsertEvent(ctx context.Context, e store.Event) error {
	r.events = append(r.events, e)
	return r.Store.InsertEvent(ctx, e)
}

func setup(t *testing.T) (*Handler, *recordingStore, store.Site) {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	site, err := st.CreateSite(ctx, "Test", "https://www.example.com/")
	if err != nil {
		t.Fatal(err)
	}
	loc, _ := geo.Open("")
	rec := &recordingStore{Store: st}
	h := &Handler{
		Store:    rec,
		Visitors: visitor.NewHasher(st),
		Geo:      loc,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:      func() time.Time { return time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC) },
	}
	return h, rec, site
}

// noOrigin makes post send no Origin header; "" sends the site's own origin, as browsers do.
const noOrigin = "-"

func post(h http.Handler, body, ua, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("User-Agent", ua)
	switch origin {
	case noOrigin:
	case "":
		req.Header.Set("Origin", "https://example.com")
	default:
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestPageview(t *testing.T) {
	h, rec, site := setup(t)
	body := `{"site":"` + site.ID + `","url":"https://blog.example.com/posts/1?utm_source=Newsletter&utm_campaign=Launch","referrer":"https://www.google.com/search?q=x"}`

	w := post(h, body, chromeUA, "https://blog.example.com")
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body)
	}
	if len(rec.events) != 1 {
		t.Fatalf("got %d events", len(rec.events))
	}
	e := rec.events[0]
	checks := map[string][2]string{
		"type":     {e.Type, "pageview"},
		"hostname": {e.Hostname, "blog.example.com"},
		"path":     {e.Path, "/posts/1"},
		"referrer": {e.ReferrerHost, "google.com"},
		"utm":      {e.UTMSource, "newsletter"},
		"campaign": {e.UTMCampaign, "Launch"},
		"browser":  {e.Browser, "Chrome"},
		"device":   {e.Device, "desktop"},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}
}

func TestCustomEventWithProps(t *testing.T) {
	h, rec, site := setup(t)
	body := `{"site":"` + site.ID + `","type":"event","name":"signup","url":"https://example.com/","props":{"plan":"pro","seats":3,"trial":true}}`

	if w := post(h, body, chromeUA, ""); w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body)
	}
	e := rec.events[0]
	if e.Name != "signup" || e.Props["plan"] != "pro" || e.Props["seats"] != "3" || e.Props["trial"] != "true" {
		t.Fatalf("unexpected event: %+v", e)
	}
}

func TestSelfReferralIgnored(t *testing.T) {
	h, rec, site := setup(t)
	body := `{"site":"` + site.ID + `","url":"https://example.com/b","referrer":"https://www.example.com/a"}`
	post(h, body, chromeUA, "")
	if rec.events[0].ReferrerHost != "" {
		t.Fatalf("referrer = %q, want empty", rec.events[0].ReferrerHost)
	}
}

func TestSameVisitorSameSession(t *testing.T) {
	h, rec, site := setup(t)
	body := `{"site":"` + site.ID + `","url":"https://example.com/"}`
	post(h, body, chromeUA, "")
	post(h, body, chromeUA, "")
	if rec.events[0].VisitorID != rec.events[1].VisitorID {
		t.Fatal("expected same visitor id for same IP + UA on same day")
	}
}

func TestRejected(t *testing.T) {
	h, rec, site := setup(t)
	cases := map[string]struct {
		body, ua, origin string
		want             int
	}{
		"unknown site":              {`{"site":"nope","url":"https://example.com/"}`, chromeUA, "", 400},
		"foreign host":              {`{"site":"` + site.ID + `","url":"https://evil.com/"}`, chromeUA, "", 400},
		"lookalike host":            {`{"site":"` + site.ID + `","url":"https://notexample.com/"}`, chromeUA, "", 400},
		"foreign origin":            {`{"site":"` + site.ID + `","url":"https://example.com/"}`, chromeUA, "https://evil.com", 400},
		"missing origin":            {`{"site":"` + site.ID + `","url":"https://example.com/"}`, chromeUA, noOrigin, 400},
		"markup in host":            {`{"site":"` + site.ID + `","url":"https://a_<b>.example.com/"}`, chromeUA, "", 400},
		"script client":             {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "python-requests/2.32", "", 202},
		"event w/o name":            {`{"site":"` + site.ID + `","type":"event","url":"https://example.com/"}`, chromeUA, "", 400},
		"bad prop type":             {`{"site":"` + site.ID + `","type":"event","name":"x","url":"https://example.com/","props":{"a":{"b":1}}}`, chromeUA, "", 400},
		"invalid json":              {`{`, chromeUA, "", 400},
		"bot is ignored":            {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Googlebot/2.1 (+http://www.google.com/bot.html)", "", 202},
		"bot UA: facebook preview":  {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "", 202},
		"bot UA: bytespider":        {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)", "", 202},
		"bot UA: gtmetrix":          {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GTmetrix", "", 202},
		"bot UA: nagios check_http": {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "check_http/v2.3.3 (nagios-plugins 2.3.3)", "", 202},
		"bot UA: site24x7":          {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (compatible; Site24x7)", "", 202},
		"bot UA: statuscake":        {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (compatible; StatusCake)", "", 202},
		"bot UA: whatsapp preview":  {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "WhatsApp/2.23.20.0 A", "", 202},
		"bot UA: google read aloud": {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (Linux; Android 7.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)", "", 202},
		"bot UA: embedly":           {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)", "", 202},
		"bot UA: apache bench":      {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "ApacheBench/2.3", "", 202},
		"empty UA is bot":           {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "", "", 202},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if w := post(h, c.body, c.ua, c.origin); w.Code != c.want {
				t.Fatalf("status = %d, want %d (body %s)", w.Code, c.want, w.Body)
			}
		})
	}
	if len(rec.events) != 0 {
		t.Fatalf("stored %d events, want 0", len(rec.events))
	}
}

func TestRejectionIsLoggedWithoutPersonalData(t *testing.T) {
	h, _, site := setup(t)
	var buf bytes.Buffer
	h.Log = slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	body := `{"site":"` + site.ID + `","url":"https://example.com/"}`
	if w := post(h, body, chromeUA, "https://evil.com"); w.Code != 400 || strings.TrimSpace(w.Body.String()) != "invalid event" {
		t.Fatalf("got %d %q, want 400 \"invalid event\"", w.Code, w.Body)
	}
	// Bots log at DEBUG, which is off here.
	post(h, body, "Googlebot/2.1", "")

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("want exactly one JSON log line, got %q: %v", buf.String(), err)
	}
	want := map[string]any{
		"msg":    "event rejected",
		"reason": "origin does not match the site's domain",
		"status": float64(400),
		"origin": "evil.com",
		"site":   site.ID,
	}
	for k, v := range want {
		if entry[k] != v {
			t.Errorf("%s = %v, want %v", k, entry[k], v)
		}
	}
	for _, secret := range []string{"192.0.2.1", "Chrome/130", "Googlebot"} {
		if strings.Contains(buf.String(), secret) {
			t.Errorf("log line contains %q: %s", secret, buf.String())
		}
	}
}

func TestPreflight(t *testing.T) {
	h, _, _ := setup(t)
	req := httptest.NewRequest(http.MethodOptions, "/api/event", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("status = %d, headers = %v", w.Code, w.Header())
	}
}

func TestNullOriginAllowed(t *testing.T) {
	h, rec, site := setup(t)
	if w := post(h, `{"site":"`+site.ID+`","url":"https://example.com/"}`, chromeUA, "null"); w.Code != http.StatusAccepted {
		t.Fatalf("status = %d", w.Code)
	}
	if len(rec.events) != 1 {
		t.Fatal("event not stored")
	}
}

func TestTextIsCleaned(t *testing.T) {
	h, rec, site := setup(t)
	body := `{"site":"` + site.ID + `","type":"event","name":"sign\nup\u202e","url":"https://example.com/a%0Ab%00c?utm_source=x%1By",` +
		`"referrer":"https://evil<script>.com/","props":{"k\u0000ey":"v\ralue"}}`
	if w := post(h, body, chromeUA, ""); w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body)
	}
	e := rec.events[0]
	checks := map[string][2]string{
		"name":     {e.Name, "signup"},
		"path":     {e.Path, "/abc"},
		"utm":      {e.UTMSource, "xy"},
		"referrer": {e.ReferrerHost, ""},
		"prop":     {e.Props["key"], "value"},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}
}

func TestVisitorLimitDropsSilently(t *testing.T) {
	h, rec, site := setup(t)
	h.VisitorLimiter = httpx.NewRateLimiter(0.001, 2)
	body := `{"site":"` + site.ID + `","url":"https://example.com/"}`
	for i := 0; i < 5; i++ {
		if w := post(h, body, chromeUA, ""); w.Code != http.StatusAccepted {
			t.Fatalf("request %d: status = %d", i, w.Code)
		}
	}
	if len(rec.events) != 2 {
		t.Fatalf("stored %d events, want 2", len(rec.events))
	}
}

func TestGlobalLimit(t *testing.T) {
	h, rec, site := setup(t)
	h.Global = rate.NewLimiter(0.001, 1)
	body := `{"site":"` + site.ID + `","url":"https://example.com/"}`
	post(h, body, chromeUA, "")
	w := post(h, body, chromeUA, "")
	if w.Code != http.StatusServiceUnavailable || w.Header().Get("Retry-After") == "" {
		t.Fatalf("status = %d, headers = %v", w.Code, w.Header())
	}
	if len(rec.events) != 1 {
		t.Fatalf("stored %d events, want 1", len(rec.events))
	}
}

func TestPeerLimitCatchesForgedForwardedFor(t *testing.T) {
	h, _, site := setup(t)
	h.ProxyHops = 2
	h.Limiter = httpx.NewRateLimiter(0.001, 1)
	h.PeerLimiter = httpx.NewRateLimiter(0.001, 2)
	body := `{"site":"` + site.ID + `","url":"https://example.com/"}`
	codes := make([]int, 0, 3)
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(body))
		req.Header.Set("User-Agent", chromeUA)
		req.Header.Set("Origin", "https://example.com")
		// A new forged client address each time, but the same real peer appended by Cloud Run.
		req.Header.Set("X-Forwarded-For", "10.0.0."+strconv.Itoa(i+1)+", 198.51.100.7")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		codes = append(codes, w.Code)
	}
	if codes[0] != 202 || codes[1] != 202 || codes[2] != 429 {
		t.Fatalf("codes = %v, want [202 202 429]", codes)
	}
}

func TestWriteSlotsFull(t *testing.T) {
	h, rec, site := setup(t)
	h.WriteSlots = make(chan struct{}, 1)
	h.WriteSlots <- struct{}{} // occupied by a stuck writer
	req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(`{"site":"`+site.ID+`","url":"https://example.com/"}`))
	req.Header.Set("User-Agent", chromeUA)
	req.Header.Set("Origin", "https://example.com")
	ctx, cancel := context.WithTimeout(req.Context(), 50*time.Millisecond)
	defer cancel()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req.WithContext(ctx))
	if len(rec.events) != 0 {
		t.Fatal("stored an event without a write slot")
	}
}
