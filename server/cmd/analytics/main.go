// Command analytics runs the analytics server and provides admin subcommands.
//
//	analytics [serve]                         start the HTTP server (default)
//	analytics sites add -domain mlz.no [-name "My site"]
//	analytics sites list
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"
	_ "time/tzdata" // embed time zones so stats work on minimal hosts

	"github.com/martinzachariassen/analytics-mlz-no/server/internal/auth"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/config"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/geo"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/server"
	"github.com/martinzachariassen/analytics-mlz-no/server/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(os.Args[1:], log); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string, log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "serve":
		return serve(cfg, log)
	case "sites":
		return sites(cfg, args)
	default:
		return fmt.Errorf("unknown command %q (want: serve, sites)", cmd)
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
	if cfg.GitHubEnabled() {
		authn.Provider = &auth.GitHub{ClientID: cfg.GitHubClientID, ClientSecret: cfg.GitHubClientSecret}
		log.Info("github sign-in enabled", "allowed", cfg.AllowedGitHubUsers, "callback", cfg.PublicURL+"/api/auth/github/callback")
	} else {
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
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr, "db", cfg.DatabasePath)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	// Cloud Run allows 10s after SIGTERM; leave time for Litestream's final sync.
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
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
