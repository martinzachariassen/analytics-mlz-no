package config

import (
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
