// Command analytics runs the analytics server and provides admin subcommands.
//
//	analytics [serve]                         start the HTTP server (default)
//	analytics sites add -domain mlz.no [-name "My site"]
//	analytics sites list
//	analytics events purge -site ID -from 2026-11-01 -to 2026-11-02 [-path /x]   delete spam
//	analytics sessions revoke [-user LOGIN]   sign a user (or everyone) out everywhere
//	analytics seed [-days 730] [-scale 1] [-reset]   demo sites with synthetic data for local development
//	analytics version                         print the version
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"text/tabwriter"
	"time"
	_ "time/tzdata" // embed time zones so stats work on minimal hosts

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/devdata"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/server"
	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// version is set at release time with -ldflags "-X main.version=v1.2.3".
var version = "dev"

// buildVersion returns the release version, or the VCS revision for local builds.
func buildVersion() string {
	if version != "dev" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" && len(s.Value) >= 7 {
				return "dev-" + s.Value[:7]
			}
		}
	}
	return version
}

// newLogger writes JSON lines that Cloud Logging understands: the level goes in "severity"
// (DEBUG, INFO, WARNING, ERROR) and the text in "message", so `severity>=ERROR` finds app errors.
// Other log collectors read the same fields. Lines below level are dropped.
func newLogger(w io.Writer, level slog.Leveler) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) > 0 {
				return a
			}
			switch a.Key {
			case slog.LevelKey:
				a.Key = "severity"
				if lvl, ok := a.Value.Any().(slog.Level); ok {
					a.Value = slog.StringValue(severity(lvl))
				}
			case slog.MessageKey:
				a.Key = "message"
			}
			return a
		},
	}))
}

func severity(l slog.Level) string {
	switch {
	case l >= slog.LevelError:
		return "ERROR"
	case l >= slog.LevelWarn:
		return "WARNING"
	case l >= slog.LevelInfo:
		return "INFO"
	default:
		return "DEBUG"
	}
}

func main() {
	// Info until LOG_LEVEL has been read.
	level := new(slog.LevelVar)
	log := newLogger(os.Stdout, level)
	if err := run(os.Args[1:], log, level); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string, log *slog.Logger, level *slog.LevelVar) error {
	// Handled before config.Load so it works without any environment.
	if len(args) > 0 && (args[0] == "version" || args[0] == "-version" || args[0] == "--version") {
		fmt.Println("analytics", buildVersion())
		return nil
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	level.Set(cfg.LogLevel)

	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "serve":
		return serve(cfg, log)
	case "sites":
		return sites(cfg, args)
	case "events":
		return events(cfg, args)
	case "sessions":
		return sessions(cfg, args)
	case "seed":
		return seed(cfg, args)
	default:
		return fmt.Errorf("unknown command %q (want: serve, sites, events, sessions, seed, version)", cmd)
	}
}

func serve(cfg config.Config, log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	loc, err := geo.Open(cfg.GeoIPPath)
	if err != nil {
		return fmt.Errorf("open geoip database: %w", err)
	}
	defer func() { _ = loc.Close() }()
	if !loc.Enabled() {
		log.Warn("GEOIP_DB_PATH not set; country will not be recorded")
	}

	authn := &auth.Service{
		Store:     st,
		Allowed:   cfg.AllowedGitHubUsers,
		PublicURL: cfg.PublicURL,
		Log:       log,
	}
	switch {
	case cfg.DevLogin:
		// config.Load only allows this on localhost; LoopbackOnly keeps the LAN out too.
		authn.Provider = auth.Dev{}
		authn.Allowed = []string{auth.DevLogin}
		authn.LoopbackOnly = true
		log.Warn("DEV_LOGIN=1: everyone who opens the dashboard is signed in as \"dev\"; local development only", "public_url", cfg.PublicURL)
	case cfg.GitHubEnabled():
		authn.Provider = &auth.GitHub{ClientID: cfg.GitHubClientID, ClientSecret: cfg.GitHubClientSecret}
		log.Info("github sign-in enabled", "allowed", cfg.AllowedGitHubUsers, "callback", cfg.PublicURL+"/api/auth/github/callback")
	default:
		log.Warn("GITHUB_CLIENT_ID not set; dashboard sign-in is disabled")
	}

	if cfg.RetentionDays > 0 {
		go retentionLoop(ctx, st, cfg.RetentionDays, log)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(cfg, st, authn, loc, log),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "version", buildVersion(), "addr", cfg.Addr, "db", cfg.DatabasePath, "log_level", severity(cfg.LogLevel), "config", cfg)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	// Restore default signal handling, so a second signal during shutdown ends the process.
	stop()

	// Cloud Run allows 10s after SIGTERM; leave time for Litestream's final sync.
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("shutdown timed out; closing open connections", "err", err)
		_ = srv.Close()
	}
	return nil
}

func retentionLoop(ctx context.Context, st *store.Store, days int, log *slog.Logger) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		cutoff := time.Now().AddDate(0, 0, -days)
		if n, err := st.DeleteEventsBefore(ctx, cutoff); err != nil {
			log.Error("retention cleanup", "err", err)
		} else if n > 0 {
			log.Info("retention cleanup", "deleted", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func sites(cfg config.Config, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: analytics sites add|list")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	switch args[0] {
	case "add":
		fs := flag.NewFlagSet("sites add", flag.ExitOnError)
		domain := fs.String("domain", "", "site domain, e.g. mlz.no (required)")
		name := fs.String("name", "", "display name (defaults to domain)")
		_ = fs.Parse(args[1:])
		site, err := st.CreateSite(ctx, *name, *domain)
		if err != nil {
			return err
		}
		fmt.Printf("Created site %q (%s)\nSite ID: %s\n", site.Name, site.Domain, site.ID)
		return nil
	case "list":
		list, err := st.ListSites(ctx)
		if err != nil {
			return err
		}
		tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(tw, "ID\tNAME\tDOMAIN\tCREATED")
		for _, s := range list {
			_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", s.ID, s.Name, s.Domain, s.CreatedAt.Format(time.DateOnly))
		}
		return tw.Flush()
	default:
		return fmt.Errorf("unknown sites command %q", args[0])
	}
}

// events manages stored events. The only subcommand, purge, removes spam after the fact.
func events(cfg config.Config, args []string) error {
	if len(args) == 0 || args[0] != "purge" {
		return errors.New("usage: analytics events purge -site ID -from TIME -to TIME [-path PATH]")
	}
	fs := flag.NewFlagSet("events purge", flag.ExitOnError)
	site := fs.String("site", "", "site id (required)")
	from := fs.String("from", "", "start, inclusive: YYYY-MM-DD (UTC) or RFC 3339 (required)")
	to := fs.String("to", "", "end, exclusive: YYYY-MM-DD (UTC) or RFC 3339 (required)")
	path := fs.String("path", "", "only delete events for this exact path")
	_ = fs.Parse(args[1:])

	f := store.PurgeFilter{SiteID: *site, Path: *path}
	var err error
	if f.From, err = parseTime(*from); err != nil {
		return fmt.Errorf("-from: %w", err)
	}
	if f.To, err = parseTime(*to); err != nil {
		return fmt.Errorf("-to: %w", err)
	}
	if f.SiteID == "" || !f.From.Before(f.To) {
		return errors.New("-site is required and -from must be before -to")
	}

	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	if _, err := st.GetSite(ctx, f.SiteID); err != nil {
		return fmt.Errorf("site %q: %w", f.SiteID, err)
	}
	n, err := st.PurgeEvents(ctx, f)
	if err != nil {
		return err
	}
	fmt.Printf("Deleted %d events.\n", n)
	return nil
}

// sessions manages dashboard sign-ins. "revoke" signs a user out everywhere, or everyone
// when no user is given: use it after removing someone from ALLOWED_GITHUB_USERS, or if a
// session token may have leaked.
func sessions(cfg config.Config, args []string) error {
	if len(args) == 0 || args[0] != "revoke" {
		return errors.New("usage: analytics sessions revoke [-user LOGIN]")
	}
	fs := flag.NewFlagSet("sessions revoke", flag.ExitOnError)
	user := fs.String("user", "", "only this user's sessions (default: everyone's)")
	_ = fs.Parse(args[1:])

	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	n, err := st.RevokeSessions(ctx, *user)
	if err != nil {
		return err
	}
	fmt.Printf("Revoked %d sessions.\n", n)
	return nil
}

func parseTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.DateOnly, s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

// demoSites are the sites `seed` creates. The first is tracked by the demo page in apps/demo.
var demoSites = []struct {
	name, domain string
	visits       int
	profile      *devdata.Profile
	goals        [][2]string // kind, value
}{
	{"Demo blog", "localhost", 80, devdata.Blog, [][2]string{{"event", "newsletter-signup"}, {"event", "contact-submit"}, {"path", "/contact"}}},
	{"Demo docs", "docs.localhost", 35, devdata.Docs, [][2]string{{"event", "copy-code"}, {"path", "/docs/*"}}},
}

// seed fills demo sites with synthetic traffic for local development.
// Existing demo sites are left alone unless -reset is given.
func seed(cfg config.Config, args []string) error {
	fs := flag.NewFlagSet("seed", flag.ExitOnError)
	days := fs.Int("days", 730, "days of history")
	scale := fs.Float64("scale", 1, "multiply the amount of traffic")
	reset := fs.Bool("reset", false, "delete the demo sites and their events first (requires DEV_LOGIN=1)")
	_ = fs.Parse(args)
	if *reset && !cfg.DevLogin {
		return errors.New("seed -reset deletes sites and is only allowed with DEV_LOGIN=1")
	}

	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	list, err := st.ListSites(ctx)
	if err != nil {
		return err
	}
	existing := map[string]string{} // domain -> id
	for _, s := range list {
		existing[s.Domain] = s.ID
	}

	for _, demo := range demoSites {
		if id, ok := existing[demo.domain]; ok {
			if !*reset {
				fmt.Printf("%s (%s) already has data in %s; run with -reset to regenerate.\n", demo.name, id, cfg.DatabasePath)
				continue
			}
			if err := st.DeleteSite(ctx, id); err != nil {
				return err
			}
		}
		site, err := st.CreateSite(ctx, demo.name, demo.domain)
		if err != nil {
			return err
		}
		for _, g := range demo.goals {
			if _, err := st.CreateGoal(ctx, site.ID, g[0], g[1]); err != nil {
				return err
			}
		}
		start := time.Now()
		n, err := devdata.Seed(ctx, st, site.ID, devdata.Options{
			Days: *days, DailyVisits: int(float64(demo.visits) * *scale), Hostname: demo.domain, Profile: demo.profile,
		})
		if err != nil {
			return err
		}
		fmt.Printf("Seeded %s (%s, %s) with %d events over %d days in %.1fs.\n",
			demo.name, site.ID, demo.domain, n, *days, time.Since(start).Seconds())
	}
	return nil
}
