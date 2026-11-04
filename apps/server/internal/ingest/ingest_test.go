package ingest

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
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

func post(h http.Handler, body, ua, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("User-Agent", ua)
	if origin != "" {
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
		"unknown site":    {`{"site":"nope","url":"https://example.com/"}`, chromeUA, "", 400},
		"foreign host":    {`{"site":"` + site.ID + `","url":"https://evil.com/"}`, chromeUA, "", 400},
		"lookalike host":  {`{"site":"` + site.ID + `","url":"https://notexample.com/"}`, chromeUA, "", 400},
		"foreign origin":  {`{"site":"` + site.ID + `","url":"https://example.com/"}`, chromeUA, "https://evil.com", 400},
		"event w/o name":  {`{"site":"` + site.ID + `","type":"event","url":"https://example.com/"}`, chromeUA, "", 400},
		"bad prop type":   {`{"site":"` + site.ID + `","type":"event","name":"x","url":"https://example.com/","props":{"a":{"b":1}}}`, chromeUA, "", 400},
		"invalid json":    {`{`, chromeUA, "", 400},
		"bot is ignored":  {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "Googlebot/2.1 (+http://www.google.com/bot.html)", "", 202},
		"empty UA is bot": {`{"site":"` + site.ID + `","url":"https://example.com/"}`, "", "", 202},
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

func TestPreflight(t *testing.T) {
	h, _, _ := setup(t)
	req := httptest.NewRequest(http.MethodOptions, "/api/event", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("status = %d, headers = %v", w.Code, w.Header())
	}
}
