// Package store wraps the SQLite database.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store is the application's data access layer.
//
// It holds two connection pools. db is the only one that writes: one connection, because
// SQLite has one writer and more connections only queue on its lock. rdb is read-only and
// serves statistics and lookups, so slow dashboard queries never hold the connection an
// incoming event needs. WAL mode lets the readers run while the writer commits.
type Store struct {
	db    *sql.DB
	rdb   *sql.DB
	sites siteCache
}

// readConns is how many read queries run at once. Each dashboard view sends a handful in
// parallel; more would only compete for the same CPU.
const readConns = 4

// Open opens (or creates) the SQLite database at path and applies pending migrations.
func Open(ctx context.Context, path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return nil, fmt.Errorf("create data dir: %w", err)
		}
	}

	w := url.Values{}
	w.Add("_pragma", "journal_mode(WAL)")
	w.Add("_pragma", "busy_timeout(5000)")
	w.Add("_pragma", "foreign_keys(1)")
	w.Add("_pragma", "synchronous(NORMAL)")
	w.Set("_txlock", "immediate")
	db, err := openPool(ctx, "file:"+path+"?"+w.Encode(), 1)
	if err != nil {
		return nil, err
	}

	s := &Store{db: db, rdb: db}
	if err := s.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	// Each connection to :memory: is a separate database, so it has to share the writer.
	if path == ":memory:" {
		return s, nil
	}

	// Opened after the migrations, so the file exists and is already in WAL mode.
	r := url.Values{}
	r.Add("_pragma", "busy_timeout(5000)")
	r.Add("_pragma", "query_only(1)")
	if s.rdb, err = openPool(ctx, "file:"+path+"?"+r.Encode(), readConns); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func openPool(ctx context.Context, dsn string, conns int) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(conns)
	db.SetMaxIdleConns(conns)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open database: %w", err)
	}
	return db, nil
}

// Size returns the bytes in use by the database: pages holding data, excluding free pages
// (so it drops right after deleting events, without a VACUUM) and the WAL.
func (s *Store) Size(ctx context.Context) (int64, error) {
	var n int64
	err := s.rdb.QueryRowContext(ctx,
		`SELECT (page_count - freelist_count) * page_size
		 FROM pragma_page_count(), pragma_freelist_count(), pragma_page_size()`).Scan(&n)
	return n, err
}

// Close closes the database.
func (s *Store) Close() error {
	if s.rdb != s.db {
		_ = s.rdb.Close()
	}
	return s.db.Close()
}

// Ping checks database connectivity.
// It uses the read pool, so a busy writer does not fail health checks.
func (s *Store) Ping(ctx context.Context) error { return s.rdb.PingContext(ctx) }

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx,
		`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		return err
	}

	files, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)

	seen := make(map[int]string, len(files))
	for _, f := range files {
		base := filepath.Base(f)
		version, err := strconv.Atoi(strings.SplitN(base, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", base)
		}
		if other, dup := seen[version]; dup {
			return fmt.Errorf("migrations %s and %s have the same version", other, base)
		}
		seen[version] = base

		var exists int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}

		body, err := migrationsFS.ReadFile(f)
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %s: %w", base, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
