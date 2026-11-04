// Package config loads server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration.
type Config struct {
	// Addr is the listen address. Defaults to ":$PORT" or ":8080".
	Addr string
	// DatabasePath is the SQLite file path.
	DatabasePath string
	// GeoIPPath is an optional path to a MaxMind-format country database (e.g. DB-IP Lite).
	GeoIPPath string
	// ProxyHops is the number of trusted reverse proxies in front of the server.
	// 0 uses the TCP remote address; n uses the n-th entry from the right of X-Forwarded-For.
	ProxyHops int
	// RetentionDays deletes events older than this many days. 0 keeps events forever.
	RetentionDays int
	// IngestRate caps accepted POST /api/event requests per second across all clients, to
	// protect the single SQLite writer. 0 disables the global limit.
	IngestRate int
	// MaxDatabaseMB pauses ingestion (503) while the database file is larger than this, so a
	// flood of events cannot fill the disk, or memory on Cloud Run where the disk is in memory.
	// The dashboard keeps working; delete events or raise the limit to resume. 0 disables it.
	MaxDatabaseMB int

	// PublicURL is the URL where users open the dashboard, e.g. https://analytics.example.com.
	// It is used for the OAuth callback and post-login redirect, and https enables Secure cookies.
	PublicURL string
	// GitHub OAuth app credentials and the GitHub usernames allowed to sign in.
	GitHubClientID     string
	GitHubClientSecret string
	AllowedGitHubUsers []string

	// DevLogin signs every visitor in as a local "dev" user without a provider.
	// Only allowed when PUBLIC_URL points to localhost, and not together with GitHub.
	DevLogin bool

	// LogLevel is the lowest level that is logged: debug, info (default), warn or error.
	LogLevel slog.Level
}

// GitHubEnabled reports whether GitHub login is configured.
func (c Config) GitHubEnabled() bool { return c.GitHubClientID != "" }

// LogValue implements slog.LogValuer so a logged Config never shows the client secret.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("addr", c.Addr),
		slog.String("database_path", c.DatabasePath),
		slog.String("public_url", c.PublicURL),
		slog.Int("proxy_hops", c.ProxyHops),
		slog.Int("retention_days", c.RetentionDays),
		slog.Int("ingest_rate_limit", c.IngestRate),
		slog.Int("max_database_mb", c.MaxDatabaseMB),
		slog.Bool("github", c.GitHubEnabled()),
		slog.Bool("dev_login", c.DevLogin),
	)
}

// Load reads configuration from the environment.
func Load() (Config, error) {
	c := Config{
		Addr:               env("ADDR", ":"+env("PORT", "8080")),
		DatabasePath:       env("DATABASE_PATH", "data/analytics.db"),
		GeoIPPath:          os.Getenv("GEOIP_DB_PATH"),
		PublicURL:          strings.TrimSuffix(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		GitHubClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		AllowedGitHubUsers: splitList(os.Getenv("ALLOWED_GITHUB_USERS")),
		DevLogin:           os.Getenv("DEV_LOGIN") == "1",
	}
	var err error
	if c.LogLevel, err = logLevel(env("LOG_LEVEL", "info")); err != nil {
		return c, err
	}
	if c.ProxyHops, err = envInt("PROXY_HOPS", 0); err != nil {
		return c, err
	}
	if c.RetentionDays, err = envInt("RETENTION_DAYS", 0); err != nil {
		return c, err
	}
	if c.IngestRate, err = envInt("INGEST_RATE_LIMIT", 200); err != nil {
		return c, err
	}
	if c.MaxDatabaseMB, err = envInt("MAX_DATABASE_MB", 0); err != nil {
		return c, err
	}
	if err := validatePublicURL(c.PublicURL); err != nil {
		return c, err
	}
	if (c.GitHubClientID == "") != (c.GitHubClientSecret == "") {
		return c, errors.New("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together")
	}
	if c.GitHubEnabled() && len(c.AllowedGitHubUsers) == 0 {
		return c, errors.New("ALLOWED_GITHUB_USERS must list at least one GitHub username")
	}
	// Sessions over plain HTTP would be sent without the Secure flag; only localhost is exempt.
	if c.GitHubEnabled() && strings.HasPrefix(c.PublicURL, "http://") && !isLocalhost(c.PublicURL) {
		return c, fmt.Errorf("PUBLIC_URL must use https when sign-in is enabled, got %q", c.PublicURL)
	}
	if c.DevLogin {
		if !isLocalhost(c.PublicURL) {
			return c, fmt.Errorf("DEV_LOGIN=1 requires PUBLIC_URL on localhost, got %q", c.PublicURL)
		}
		if c.GitHubEnabled() {
			return c, errors.New("DEV_LOGIN=1 cannot be combined with GitHub sign-in")
		}
	}
	return c, nil
}

// validatePublicURL requires an absolute origin with no path, query or fragment.
func validatePublicURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("PUBLIC_URL must be an absolute http(s) URL, got %q", raw)
	}
	if u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("PUBLIC_URL must be an origin without a path, got %q", raw)
	}
	return nil
}

// isLocalhost reports whether rawURL is a plain-HTTP URL on the loopback interface.
func isLocalhost(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "http" {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func logLevel(v string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("LOG_LEVEL must be debug, info, warn or error, got %q", v)
}

func envInt(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer, got %q", key, v)
	}
	return n, nil
}
