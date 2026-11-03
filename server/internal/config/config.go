// Package config loads server configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
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
}

// Load reads configuration from the environment.
func Load() (Config, error) {
	c := Config{
		Addr:         env("ADDR", ":"+env("PORT", "8080")),
		DatabasePath: env("DATABASE_PATH", "data/analytics.db"),
		GeoIPPath:    os.Getenv("GEOIP_DB_PATH"),
	}
	var err error
	if c.ProxyHops, err = envInt("PROXY_HOPS", 0); err != nil {
		return c, err
	}
	if c.RetentionDays, err = envInt("RETENTION_DAYS", 0); err != nil {
		return c, err
	}
	return c, nil
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
