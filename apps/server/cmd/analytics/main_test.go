package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestNewLoggerUsesCloudLoggingFields(t *testing.T) {
	var buf bytes.Buffer
	log := newLogger(&buf)
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
