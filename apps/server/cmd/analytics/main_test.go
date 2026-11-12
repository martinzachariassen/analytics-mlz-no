package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseTime(t *testing.T) {
	day, err := parseTime("2026-11-04")
	if err != nil || !day.Equal(time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("date: %v, %v", day, err)
	}
	ts, err := parseTime("2026-11-04T10:30:00+01:00")
	if err != nil || !ts.Equal(time.Date(2026, 11, 4, 9, 30, 0, 0, time.UTC)) {
		t.Fatalf("rfc3339: %v, %v", ts, err)
	}
	for _, bad := range []string{"", "yesterday", "2026-13-01", "04.11.2026"} {
		if _, err := parseTime(bad); err == nil {
			t.Errorf("parseTime(%q) accepted", bad)
		}
	}
}

func TestCLI(t *testing.T) {
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "cli.db"))
	t.Setenv("PUBLIC_URL", "http://localhost:8080")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	level := new(slog.LevelVar)

	run := func(args ...string) (string, error) {
		t.Helper()
		r, w, _ := os.Pipe()
		stdout := os.Stdout
		os.Stdout = w
		err := run(args, log, level)
		os.Stdout = stdout
		_ = w.Close()
		out, _ := io.ReadAll(r)
		return string(out), err
	}

	if out, err := run("version"); err != nil || !strings.HasPrefix(out, "analytics ") {
		t.Fatalf("version: %q, %v", out, err)
	}
	if _, err := run("bogus"); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("bogus: %v", err)
	}
	out, err := run("sites", "add", "-domain", "https://www.mlz.no/", "-name", "Blog")
	if err != nil || !strings.Contains(out, "Site ID: ") {
		t.Fatalf("sites add: %q, %v", out, err)
	}
	id := strings.TrimSpace(strings.SplitN(out, "Site ID: ", 2)[1])
	if _, err := run("sites", "add", "-domain", "mlz.no"); err == nil {
		t.Fatal("duplicate domain accepted")
	}
	if _, err := run("sites", "add", "-domain", "not a domain"); err == nil {
		t.Fatal("invalid domain accepted")
	}
	if out, err := run("sites", "list"); err != nil || !strings.Contains(out, id) || !strings.Contains(out, "Blog") {
		t.Fatalf("sites list: %q, %v", out, err)
	}
	if out, err := run("events", "purge", "-site", id, "-from", "2026-11-01", "-to", "2026-11-02"); err != nil || !strings.Contains(out, "Deleted 0 events") {
		t.Fatalf("purge: %q, %v", out, err)
	}
	if _, err := run("events", "purge", "-site", id, "-from", "2026-11-02", "-to", "2026-11-01"); err == nil {
		t.Fatal("reversed purge accepted")
	}
	if _, err := run("events", "purge", "-site", "nope", "-from", "2026-11-01", "-to", "2026-11-02"); err == nil {
		t.Fatal("purge of unknown site accepted")
	}
	if out, err := run("sessions", "revoke"); err != nil || !strings.Contains(out, "Revoked 0 sessions") {
		t.Fatalf("sessions revoke: %q, %v", out, err)
	}
	if _, err := run("sessions", "list"); err == nil {
		t.Fatal("unknown sessions subcommand accepted")
	}
	if _, err := run("seed", "-reset"); err == nil || !strings.Contains(err.Error(), "DEV_LOGIN") {
		t.Fatalf("seed -reset without DEV_LOGIN: %v", err)
	}
}

func TestNewLoggerDebugLevel(t *testing.T) {
	var buf bytes.Buffer
	level := new(slog.LevelVar)
	log := newLogger(&buf, level)
	log.Debug("before")
	level.Set(slog.LevelDebug)
	log.Debug("after")

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("want one JSON line, got %q: %v", buf.String(), err)
	}
	if entry["severity"] != "DEBUG" || entry["message"] != "after" {
		t.Fatalf("got %s, want the DEBUG line logged after the level change", buf.String())
	}
}

func TestNewLoggerUsesCloudLoggingFields(t *testing.T) {
	var buf bytes.Buffer
	log := newLogger(&buf, slog.LevelInfo)
	log.Debug("hidden at info")
	log.Info("listening", "addr", ":8080")
	log.Warn("careful")
	log.Error("insert event", "err", "boom")

	want := []struct{ severity, message string }{
		{"INFO", "listening"},
		{"WARNING", "careful"},
		{"ERROR", "insert event"},
	}
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != len(want) {
		t.Fatalf("got %d lines, want %d:\n%s", len(lines), len(want), buf.String())
	}
	for i, line := range lines {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("line %d is not JSON: %v", i, err)
		}
		if entry["severity"] != want[i].severity || entry["message"] != want[i].message {
			t.Errorf("line %d = %s, want severity %q message %q", i, line, want[i].severity, want[i].message)
		}
		if _, ok := entry["level"]; ok {
			t.Errorf("line %d still has a level field: %s", i, line)
		}
		if _, ok := entry["msg"]; ok {
			t.Errorf("line %d still has a msg field: %s", i, line)
		}
	}
}
