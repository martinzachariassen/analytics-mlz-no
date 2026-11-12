package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// Slow dashboard queries must never hold the connection an incoming event needs.
func TestWritesDoNotWaitForReads(t *testing.T) {
	st := openTemp(t)
	ctx := context.Background()
	site, err := st.CreateSite(ctx, "", "example.com")
	if err != nil {
		t.Fatal(err)
	}

	// Occupy every read connection, as a dashboard loading a long range would.
	for range readConns {
		tx, err := st.rdb.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = tx.Rollback() })
	}

	wctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	ev := Event{SiteID: site.ID, Time: time.Now(), Type: "pageview", Path: "/", VisitorID: 1}
	if err := st.InsertEvent(wctx, ev); err != nil {
		t.Fatalf("insert while reads are busy: %v", err)
	}
}

func TestReadPoolIsReadOnly(t *testing.T) {
	st := openTemp(t)
	if _, err := st.rdb.ExecContext(context.Background(), `DELETE FROM sites`); err == nil {
		t.Fatal("read pool accepted a write")
	}
	if st.rdb == st.db {
		t.Fatal("a file database must have a separate read pool")
	}
}
