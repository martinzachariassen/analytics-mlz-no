package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
)

func TestSizeGuard(t *testing.T) {
	size, fail := int64(10), false
	g := &sizeGuard{
		size: func(context.Context) (int64, error) {
			if fail {
				return 0, errors.New("boom")
			}
			return size, nil
		},
		max: 100,
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if g.Paused() {
		t.Fatal("paused under the limit")
	}
	size = 200
	if !g.Paused() {
		t.Fatal("not paused over the limit")
	}
	fail = true
	if !g.Paused() {
		t.Fatal("a failed check should keep the last state")
	}
	fail, size = false, 50
	if g.Paused() {
		t.Fatal("still paused after shrinking")
	}
}
