package config

import (
	"log/slog"
	"strings"
	"testing"
)

func TestDevLogin(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{"localhost", map[string]string{"PUBLIC_URL": "http://localhost:5173"}, ""},
		{"loopback ip", map[string]string{"PUBLIC_URL": "http://127.0.0.1:8080"}, ""},
		{"public host", map[string]string{"PUBLIC_URL": "https://t.example.com"}, "requires PUBLIC_URL on localhost"},
		{"https localhost", map[string]string{"PUBLIC_URL": "https://localhost"}, "requires PUBLIC_URL on localhost"},
		{"localhost lookalike", map[string]string{"PUBLIC_URL": "http://localhost.example.com"}, "requires PUBLIC_URL on localhost"},
		{"with github", map[string]string{
			"PUBLIC_URL": "http://localhost:8080", "GITHUB_CLIENT_ID": "id", "GITHUB_CLIENT_SECRET": "s", "ALLOWED_GITHUB_USERS": "me",
		}, "cannot be combined"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for _, k := range []string{"GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ALLOWED_GITHUB_USERS"} {
				t.Setenv(k, "")
			}
			t.Setenv("DEV_LOGIN", "1")
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			cfg, err := Load()
			if c.wantErr == "" {
				if err != nil || !cfg.DevLogin {
					t.Fatalf("Load() = %+v, %v", cfg.DevLogin, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("Load() error = %v, want %q", err, c.wantErr)
			}
		})
	}
}

func TestValidation(t *testing.T) {
	cases := map[string]struct {
		env     map[string]string
		wantErr string
	}{
		"defaults":           {nil, ""},
		"negative hops":      {map[string]string{"PROXY_HOPS": "-1"}, "PROXY_HOPS"},
		"non-numeric rate":   {map[string]string{"INGEST_RATE_LIMIT": "lots"}, "INGEST_RATE_LIMIT"},
		"client id alone":    {map[string]string{"GITHUB_CLIENT_ID": "id"}, "must be set together"},
		"secret alone":       {map[string]string{"GITHUB_CLIENT_SECRET": "s"}, "must be set together"},
		"empty allowlist":    {map[string]string{"GITHUB_CLIENT_ID": "id", "GITHUB_CLIENT_SECRET": "s"}, "ALLOWED_GITHUB_USERS"},
		"relative url":       {map[string]string{"PUBLIC_URL": "analytics.example.com"}, "absolute http(s) URL"},
		"url with path":      {map[string]string{"PUBLIC_URL": "https://example.com/stats"}, "without a path"},
		"url with query":     {map[string]string{"PUBLIC_URL": "https://example.com/?x"}, "without a path"},
		"trailing slash ok":  {map[string]string{"PUBLIC_URL": "https://example.com/"}, ""},
		"http on lan, no ui": {map[string]string{"PUBLIC_URL": "http://stats.lan"}, ""},
		"http on lan, login": {map[string]string{"PUBLIC_URL": "http://stats.lan", "GITHUB_CLIENT_ID": "id", "GITHUB_CLIENT_SECRET": "s", "ALLOWED_GITHUB_USERS": "me"}, "must use https"},
		"http localhost ok":  {map[string]string{"PUBLIC_URL": "http://localhost:5173", "GITHUB_CLIENT_ID": "id", "GITHUB_CLIENT_SECRET": "s", "ALLOWED_GITHUB_USERS": "me"}, ""},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			for _, k := range []string{"GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ALLOWED_GITHUB_USERS", "DEV_LOGIN", "PUBLIC_URL", "PROXY_HOPS", "INGEST_RATE_LIMIT"} {
				t.Setenv(k, "")
			}
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			_, err := Load()
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("Load() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("Load() error = %v, want %q", err, c.wantErr)
			}
		})
	}
}

func TestLogValueHidesSecret(t *testing.T) {
	c := Config{GitHubClientID: "id", GitHubClientSecret: "hunter2", PublicURL: "https://x"}
	if s := c.LogValue().String(); strings.Contains(s, "hunter2") || !strings.Contains(s, "github=true") {
		t.Fatalf("LogValue = %s", s)
	}
}

func TestLogLevel(t *testing.T) {
	cases := map[string]struct {
		want    slog.Level
		wantErr bool
	}{
		"":        {slog.LevelInfo, false},
		"debug":   {slog.LevelDebug, false},
		"INFO":    {slog.LevelInfo, false},
		"warning": {slog.LevelWarn, false},
		"error":   {slog.LevelError, false},
		"verbose": {0, true},
	}
	for v, c := range cases {
		t.Run(v, func(t *testing.T) {
			t.Setenv("LOG_LEVEL", v)
			cfg, err := Load()
			if c.wantErr {
				if err == nil || !strings.Contains(err.Error(), "LOG_LEVEL") {
					t.Fatalf("Load() error = %v, want a LOG_LEVEL error", err)
				}
				return
			}
			if err != nil || cfg.LogLevel != c.want {
				t.Fatalf("Load() = %v, %v; want %v", cfg.LogLevel, err, c.want)
			}
		})
	}
}
