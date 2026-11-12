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

// UserBySession returns the user owning an unexpired session and when the session expires.
func (s *Store) UserBySession(ctx context.Context, tokenHash []byte, now time.Time) (User, time.Time, error) {
	var u User
	var expires int64
	err := s.rdb.QueryRowContext(ctx,
		`SELECT u.id, u.provider, u.provider_id, u.login, s.expires_at FROM sessions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, now.UnixMilli()).
		Scan(&u.ID, &u.Provider, &u.ProviderID, &u.Login, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, time.Time{}, ErrNotFound
	}
	if err != nil {
		return User{}, time.Time{}, err
	}
	return u, time.UnixMilli(expires).UTC(), nil
}

// DeleteSession removes a session (logout).
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// ExtendSession moves a session's expiry forward (sliding renewal).
func (s *Store) ExtendSession(ctx context.Context, tokenHash []byte, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, expires.UnixMilli(), tokenHash)
	return err
}

// DeleteUserSessions signs a user out everywhere.
func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

// RevokeSessions deletes sessions: all of them when login is empty, otherwise those of the
// user with that login (case-insensitive). It returns the number deleted.
func (s *Store) RevokeSessions(ctx context.Context, login string) (int64, error) {
	var res sql.Result
	var err error
	if login == "" {
		res, err = s.db.ExecContext(ctx, `DELETE FROM sessions`)
	} else {
		res, err = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE login = ?)`, login)
	}
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteExpiredSessions removes sessions that expired before now.
func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now.UnixMilli())
	return err
}
