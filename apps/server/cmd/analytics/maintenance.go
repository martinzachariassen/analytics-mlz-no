package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/store"
)

// maintenanceLoop runs maintain at startup, every hour and just after each UTC midnight, so
// the previous day's visitor salt is deleted when the day ends even if no event arrives.
func maintenanceLoop(ctx context.Context, st *store.Store, retentionDays int, log *slog.Logger) {
	for {
		maintain(ctx, st, retentionDays, time.Now(), log)
		t := time.NewTimer(untilNextRun(time.Now()))
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// untilNextRun is the time until the next hour or the next UTC midnight, whichever comes
// first, plus a second so the run lands on the new day.
func untilNextRun(now time.Time) time.Duration {
	u := now.UTC()
	midnight := time.Date(u.Year(), u.Month(), u.Day()+1, 0, 0, 1, 0, time.UTC)
	return min(time.Hour, midnight.Sub(u))
}

// maintain rotates the visitor salt to today's (deleting older ones), deletes expired
// sessions and, with retentionDays > 0, events older than that. Failures are logged and
// retried on the next run.
func maintain(ctx context.Context, st *store.Store, retentionDays int, now time.Time, log *slog.Logger) {
	if _, err := st.SaltForDay(ctx, now.UTC().Format(time.DateOnly)); err != nil {
		log.Error("salt rotation", "err", err)
	}
	if err := st.DeleteExpiredSessions(ctx, now); err != nil {
		log.Error("expired session cleanup", "err", err)
	}
	if retentionDays > 0 {
		if n, err := st.DeleteEventsBefore(ctx, now.AddDate(0, 0, -retentionDays)); err != nil {
			log.Error("retention cleanup", "err", err)
		} else if n > 0 {
			log.Info("retention cleanup", "deleted", n)
		}
	}
}
