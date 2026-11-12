-- When a session was created, so sliding renewal can stop at a maximum age. Existing sessions
-- get their last renewal time (expiry minus the 7-day lifetime) as a stand-in.
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; -- unix ms
UPDATE sessions SET created_at = expires_at - 604800000;
