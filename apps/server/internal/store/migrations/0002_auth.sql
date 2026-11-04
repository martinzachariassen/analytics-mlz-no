-- Dashboard users, authenticated through an external identity provider (e.g. GitHub).
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    provider      TEXT    NOT NULL,                -- e.g. "github"
    provider_id   TEXT    NOT NULL,                -- stable id at the provider (survives renames)
    login         TEXT    NOT NULL COLLATE NOCASE, -- username at the provider
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL,
    UNIQUE (provider, provider_id),
    UNIQUE (provider, login)
);

-- Login sessions. Only a SHA-256 hash of the token is stored.
CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL  -- unix ms
);

CREATE INDEX sessions_expires ON sessions (expires_at);
