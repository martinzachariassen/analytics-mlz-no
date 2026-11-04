package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLoginUser(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	now := time.Now()

	u, err := st.LoginUser(ctx, "github", "1", "martin", now)
	if err != nil {
		t.Fatal(err)
	}
	// Rename at GitHub: same id, new login.
	renamed, err := st.LoginUser(ctx, "github", "1", "martin-z", now)
	if err != nil || renamed.ID != u.ID || renamed.Login != "martin-z" {
		t.Fatalf("rename: %+v, %v", renamed, err)
	}
	// Someone else registers "MARTIN-Z" (case-insensitive) with another id.
	if _, err := st.LoginUser(ctx, "github", "2", "MARTIN-Z", now); !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("err = %v, want ErrIdentityConflict", err)
	}
	// The released old name can be taken by a new account.
	if _, err := st.LoginUser(ctx, "github", "3", "martin", now); err != nil {
		t.Fatalf("new account with released name: %v", err)
	}
}

func TestUserSessions(t *testing.T) {
	ctx := context.Background()
	st := openTemp(t)
	t0 := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	u, err := st.LoginUser(ctx, "github", "1", "martin", t0)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := st.LoginUser(ctx, "github", "2", "other", t0)

	hash := []byte("hash-1")
	if err := st.CreateSession(ctx, hash, u.ID, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	_ = st.CreateSession(ctx, []byte("hash-2"), u.ID, t0.Add(time.Hour))
	_ = st.CreateSession(ctx, []byte("hash-3"), other.ID, t0.Add(time.Hour))

	got, expires, err := st.UserBySession(ctx, hash, t0)
	if err != nil || got.ID != u.ID || !expires.Equal(t0.Add(time.Hour)) {
		t.Fatalf("UserBySession = %+v, %v, %v", got, expires, err)
	}
	if _, _, err := st.UserBySession(ctx, hash, t0.Add(2*time.Hour)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session: err = %v, want ErrNotFound", err)
	}
	if _, _, err := st.UserBySession(ctx, []byte("nope"), t0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown session: err = %v, want ErrNotFound", err)
	}

	if err := st.ExtendSession(ctx, hash, t0.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, expires, err := st.UserBySession(ctx, hash, t0.Add(2*time.Hour)); err != nil || !expires.Equal(t0.Add(3*time.Hour)) {
		t.Fatalf("after extend: %v, %v", expires, err)
	}

	// Expired sessions are swept; live ones stay.
	_ = st.CreateSession(ctx, []byte("old"), u.ID, t0.Add(-time.Minute))
	if err := st.DeleteExpiredSessions(ctx, t0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.UserBySession(ctx, []byte("old"), t0.Add(-2*time.Minute)); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session should have been deleted")
	}

	n, err := st.RevokeSessions(ctx, "MARTIN")
	if err != nil || n != 2 {
		t.Fatalf("RevokeSessions(martin) = %d, %v; want 2", n, err)
	}
	if _, _, err := st.UserBySession(ctx, []byte("hash-3"), t0); err != nil {
		t.Fatal("the other user's session must survive")
	}
	if err := st.DeleteUserSessions(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.UserBySession(ctx, []byte("hash-3"), t0); !errors.Is(err, ErrNotFound) {
		t.Fatal("DeleteUserSessions did not delete")
	}
	_ = st.CreateSession(ctx, []byte("a"), u.ID, t0.Add(time.Hour))
	_ = st.CreateSession(ctx, []byte("b"), other.ID, t0.Add(time.Hour))
	if n, err := st.RevokeSessions(ctx, ""); err != nil || n != 2 {
		t.Fatalf("RevokeSessions(all) = %d, %v; want 2", n, err)
	}
}
