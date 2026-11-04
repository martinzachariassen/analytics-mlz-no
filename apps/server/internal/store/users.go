package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrIdentityConflict is returned when a login name is already bound to a
// different account at the provider (e.g. a GitHub username that was released
// and re-registered by someone else).
var ErrIdentityConflict = errors.New("login is bound to a different account")

// User is a dashboard user.
type User struct {
	ID         int64
	Provider   string
	ProviderID string
	Login      string
}

// LoginUser records a successful sign-in from an identity provider and returns the user.
//
// Users are identified by their stable provider id. On first sign-in the login
// name is bound to that id; a later sign-in with the same login but another id
// fails with ErrIdentityConflict. Renames at the provider update the stored login.
func (s *Store) LoginUser(ctx context.Context, provider, providerID, login string, now time.Time) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	u, err := scanUser(tx.QueryRowContext(ctx,
		`SELECT id, provider, provider_id, login FROM users WHERE provider = ? AND provider_id = ?`,
		provider, providerID))
	switch {
	case err == nil:
		var other int64
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM users WHERE provider = ? AND login = ? AND id <> ?`, provider, login, u.ID).Scan(&other)
		if err == nil {
			return User{}, ErrIdentityConflict
		} else if !errors.Is(err, sql.ErrNoRows) {
			return User{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET login = ?, last_login_at = ? WHERE id = ?`, login, now.UnixMilli(), u.ID); err != nil {
			return User{}, err
		}
		u.Login = login

	case errors.Is(err, ErrNotFound):
		var existing int64
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM users WHERE provider = ? AND login = ?`, provider, login).Scan(&existing)
		if err == nil {
			return User{}, ErrIdentityConflict
		} else if !errors.Is(err, sql.ErrNoRows) {
			return User{}, err
		}
		res, err := tx.ExecContext(ctx,
			`INSERT INTO users (provider, provider_id, login, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)`,
			provider, providerID, login, now.UnixMilli(), now.UnixMilli())
		if err != nil {
			return User{}, err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return User{}, err
		}
		u = User{ID: id, Provider: provider, ProviderID: providerID, Login: login}

	default:
		return User{}, err
	}
	return u, tx.Commit()
}

func scanUser(row *sql.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Provider, &u.ProviderID, &u.Login)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// CreateSession stores a session token hash for the user.
func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, userID int64, expires time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		tokenHash, userID, expires.UnixMilli())
	return err
}

// UserBySession returns the user owning an unexpired session.
func (s *Store) UserBySession(ctx context.Context, tokenHash []byte, now time.Time) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT u.id, u.provider, u.provider_id, u.login FROM sessions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, now.UnixMilli()))
}

// DeleteSession removes a session (logout).
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// DeleteExpiredSessions removes sessions that expired before now.
func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now.UnixMilli())
	return err
}
