package store

import (
	"os"
	"strings"
	"testing"
)

// TestDimensionsAreDocumented keeps docs/reference/api.md in step with the dimension
// whitelists: every breakdown dimension, filter dimension and filter operator must
// appear there in backticks.
func TestDimensionsAreDocumented(t *testing.T) {
	doc, err := os.ReadFile("../../../../docs/reference/api.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, list := range []struct {
		name  string
		names []string
	}{
		{"Dimensions", Dimensions},
		{"FilterDims", FilterDims},
		{"FilterOps", FilterOps},
	} {
		for _, n := range list.names {
			if !strings.Contains(string(doc), "`"+n+"`") {
				t.Errorf("store.%s has %q, but docs/reference/api.md does not mention it", list.name, n)
			}
		}
	}
}
