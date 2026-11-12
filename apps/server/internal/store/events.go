package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"errors"
	"time"
)

// SessionTimeout is the inactivity window after which a visitor starts a new session.
const SessionTimeout = 30 * time.Minute

// Event is a single tracked page view or custom event.
type Event struct {
	SiteID       string
	Time         time.Time
	Type         string // "pageview" or "event"
	Name         string
	Hostname     string
	Path         string
	ReferrerHost string
	UTMSource    string
	UTMMedium    string
	UTMCampaign  string
	Country      string
	Browser      string
	OS           string
	Device       string
	VisitorID    int64
	Props        map[string]string
}

// InsertEvent stores an event. The session id is assigned automatically: the visitor's
// most recent session is reused if it had activity within SessionTimeout.
func (s *Store) InsertEvent(ctx context.Context, e Event) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	ts := e.Time.UnixMilli()

	var sessionID int64
	err = tx.QueryRowContext(ctx,
		`SELECT session_id FROM events
		 WHERE site_id = ? AND visitor_id = ? AND ts >= ?
		 ORDER BY ts DESC LIMIT 1`,
		e.SiteID, e.VisitorID, ts-SessionTimeout.Milliseconds()).Scan(&sessionID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		sessionID = randomInt63()
	case err != nil:
		return err
	}

	res, err := tx.ExecContext(ctx,
		`INSERT INTO events (site_id, ts, type, name, hostname, path, referrer_host,
		    utm_source, utm_medium, utm_campaign, country, browser, os, device,
		    visitor_id, session_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.SiteID, ts, e.Type, e.Name, e.Hostname, e.Path, e.ReferrerHost,
		e.UTMSource, e.UTMMedium, e.UTMCampaign, e.Country, e.Browser, e.OS, e.Device,
		e.VisitorID, sessionID)
	if err != nil {
		return err
	}

	if len(e.Props) > 0 {
		eventID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for k, v := range e.Props {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO event_props (event_id, key, value) VALUES (?, ?, ?)`,
				eventID, k, v); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// DeleteEventsBefore removes events older than t in batches and returns the number deleted.
func (s *Store) DeleteEventsBefore(ctx context.Context, t time.Time) (int64, error) {
	var total int64
	for {
		res, err := s.db.ExecContext(ctx,
			`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE ts < ? LIMIT 5000)`,
			t.UnixMilli())
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
		if n == 0 {
			return total, nil
		}
	}
}

// PurgeFilter selects events to delete with PurgeEvents. Path is optional (exact match).
type PurgeFilter struct {
	SiteID   string
	From, To time.Time // half-open: From <= ts < To
	Path     string
}

// PurgeEvents deletes the events matching f in batches and returns the number deleted.
// It is meant for cleaning up spam after the fact. Sessions are derived from events, so
// nothing else needs updating; event props cascade.
func (s *Store) PurgeEvents(ctx context.Context, f PurgeFilter) (int64, error) {
	where := `site_id = ? AND ts >= ? AND ts < ?`
	args := []any{f.SiteID, f.From.UnixMilli(), f.To.UnixMilli()}
	if f.Path != "" {
		where += ` AND path = ?`
		args = append(args, f.Path)
	}
	var total int64
	for {
		res, err := s.db.ExecContext(ctx,
			`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE `+where+` LIMIT 5000)`, args...)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
		if n == 0 {
			return total, nil
		}
	}
}

// SaltForDay returns the salt for day (YYYY-MM-DD), creating it if needed,
// and deletes salts for all other days.
func (s *Store) SaltForDay(ctx context.Context, day string) ([]byte, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	fresh := make([]byte, 32)
	_, _ = rand.Read(fresh)
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)`, day, fresh); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM salts WHERE day <> ?`, day); err != nil {
		return nil, err
	}
	var salt []byte
	if err := tx.QueryRowContext(ctx,
		`SELECT salt FROM salts WHERE day = ?`, day).Scan(&salt); err != nil {
		return nil, err
	}
	return salt, tx.Commit()
}

func randomInt63() int64 {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return int64(binary.BigEndian.Uint64(b[:]) >> 1)
}
