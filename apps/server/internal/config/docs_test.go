package config

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestEveryVariableIsDocumented keeps docs/reference/configuration.md in step with Load:
// every environment variable read in config.go must appear there in backticks.
func TestEveryVariableIsDocumented(t *testing.T) {
	src, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := os.ReadFile("../../../../docs/reference/configuration.md")
	if err != nil {
		t.Fatal(err)
	}

	re := regexp.MustCompile(`(?:env|envInt|os\.Getenv)\("([A-Z0-9_]+)"`)
	vars := re.FindAllStringSubmatch(string(src), -1)
	if len(vars) < 10 {
		t.Fatalf("found only %d variables in config.go; has the way they are read changed?", len(vars))
	}
	for _, m := range vars {
		if !strings.Contains(string(doc), "`"+m[1]+"`") {
			t.Errorf("%s is read in config.go but not documented in docs/reference/configuration.md", m[1])
		}
	}
}
