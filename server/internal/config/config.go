// Package config loads server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
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

	// PublicURL is the URL where users open the dashboard, e.g. https://analytics.example.com.
	// It is used for the OAuth callback and post-login redirect, and https enables Secure cookies.
	PublicURL string
	// GitHub OAuth app credentials and the GitHub usernames allowed to sign in.
	GitHubClientID     string
	GitHubClientSecret string
	AllowedGitHubUsers []string
}

// GitHubEnabled reports whether GitHub login is configured.
func (c Config) GitHubEnabled() bool { return c.GitHubClientID != "" }

// CookieSecure reports whether session cookies should have the Secure flag.
func (c Config) CookieSecure() bool { return strings.HasPrefix(c.PublicURL, "https://") }

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
	}
	var err error
	if c.ProxyHops, err = envInt("PROXY_HOPS", 0); err != nil {
		return c, err
	}
	if c.RetentionDays, err = envInt("RETENTION_DAYS", 0); err != nil {
		return c, err
	}
	if u, err := url.Parse(c.PublicURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return c, fmt.Errorf("PUBLIC_URL must be an absolute http(s) URL, got %q", c.PublicURL)
	}
	if (c.GitHubClientID == "") != (c.GitHubClientSecret == "") {
		return c, errors.New("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together")
	}
	if c.GitHubEnabled() && len(c.AllowedGitHubUsers) == 0 {
		return c, errors.New("ALLOWED_GITHUB_USERS must list at least one GitHub username")
	}
	return c, nil
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
