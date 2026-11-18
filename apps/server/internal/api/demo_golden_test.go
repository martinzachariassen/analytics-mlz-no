package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// The public demo (apps/web/src/demo) answers the dashboard's requests in the browser
// with a TypeScript copy of this API. TestDemoGolden runs a fixed list of requests
// against the real API over a fixed set of events and compares the answers with
// golden.json; the demo's golden.test.ts checks its engine against the same file, so the
// two cannot drift apart. UPDATE_GOLDEN=1 rewrites golden.json after a deliberate change.
const demoTestdata = "../../../web/src/demo/testdata"

type demoFixture struct {
	Now      time.Time   `json:"now"`
	Goals    [][2]string `json:"goals"`
	Requests []string    `json:"requests"`
}

type demoEvent struct {
	TS          int64             `json:"ts"`
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Hostname    string            `json:"hostname"`
	Path        string            `json:"path"`
	Referrer    string            `json:"referrer"`
	UTMSource   string            `json:"utm_source"`
	UTMMedium   string            `json:"utm_medium"`
	UTMCampaign string            `json:"utm_campaign"`
	Country     string            `json:"country"`
	Browser     string            `json:"browser"`
	OS          string            `json:"os"`
	Device      string            `json:"device"`
	Visitor     int64             `json:"visitor"`
	Props       map[string]string `json:"props"`
}

// goldenAnswer is one response: JSON (with goal creation times removed, since they are
// set when the test runs) or the text of a CSV export with the headers that name it.
type goldenAnswer struct {
	Request string            `json:"request"`
	Status  int               `json:"status"`
	JSON    any               `json:"json,omitempty"`
	Text    string            `json:"text,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

func readJSON(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(demoTestdata, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// withoutCreatedAt drops every created_at field from decoded JSON.
func withoutCreatedAt(v any) any {
	switch x := v.(type) {
	case map[string]any:
		delete(x, "created_at")
		for k, e := range x {
			x[k] = withoutCreatedAt(e)
		}
	case []any:
		for i, e := range x {
			x[i] = withoutCreatedAt(e)
		}
	}
	return v
}

func TestDemoGolden(t *testing.T) {
	var fx demoFixture
	readJSON(t, "requests.json", &fx)
	var events []demoEvent
	readJSON(t, "events.json", &events)

	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "golden.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	site, err := st.CreateSite(ctx, "Lumen", "lumen.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range fx.Goals {
		if _, err := st.CreateGoal(ctx, site.ID, g[0], g[1]); err != nil {
			t.Fatal(err)
		}
	}
	for _, e := range events {
		err := st.InsertEvent(ctx, store.Event{
			SiteID: site.ID, Time: time.UnixMilli(e.TS), Type: e.Type, Name: e.Name,
			Hostname: e.Hostname, Path: e.Path, ReferrerHost: e.Referrer,
			UTMSource: e.UTMSource, UTMMedium: e.UTMMedium, UTMCampaign: e.UTMCampaign,
			Country: e.Country, Browser: e.Browser, OS: e.OS, Device: e.Device,
			VisitorID: e.Visitor, Props: e.Props,
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	mux := http.NewServeMux()
	a := &API{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return fx.Now }}
	a.Register(mux, func(h http.Handler) http.Handler { return h })

	answers := make([]goldenAnswer, 0, len(fx.Requests))
	for _, req := range fx.Requests {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, strings.ReplaceAll(req, "{site}", site.ID), nil))
		ans := goldenAnswer{Request: req, Status: w.Code}
		if strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
			ans.Text = w.Body.String()
			ans.Headers = map[string]string{"Content-Disposition": w.Header().Get("Content-Disposition")}
			if v := w.Header().Get("X-Truncated"); v != "" {
				ans.Headers["X-Truncated"] = v
			}
		} else {
			var v any
			if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
				t.Fatalf("%s: %v (%s)", req, err, w.Body)
			}
			ans.JSON = withoutCreatedAt(v)
		}
		answers = append(answers, ans)
	}

	// Not HTML-escaped, so the requests read as written ("&", not "\u0026").
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(answers); err != nil {
		t.Fatal(err)
	}
	got := buf.Bytes()
	path := filepath.Join(demoTestdata, "golden.json")
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(path, got, 0o600); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		var old []goldenAnswer
		_ = json.Unmarshal(want, &old)
		for i, ans := range answers {
			a, _ := json.Marshal(ans)
			var b []byte
			if i < len(old) {
				b, _ = json.Marshal(old[i])
			}
			if !bytes.Equal(a, b) {
				t.Fatalf("the API's answer to %s changed; if that is intended, run UPDATE_GOLDEN=1 go test ./apps/server/internal/api -run TestDemoGolden and check the demo engine with bun run test", ans.Request)
			}
		}
		t.Fatal("golden.json is out of date; run UPDATE_GOLDEN=1 go test ./apps/server/internal/api -run TestDemoGolden")
	}
}
