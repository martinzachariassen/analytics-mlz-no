-- Goals: what counts as a conversion on a site. Conversions are computed from events at
-- query time, so a new goal also covers past traffic.
CREATE TABLE goals (
    id         INTEGER PRIMARY KEY,
    site_id    TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('event', 'path')),
    value      TEXT    NOT NULL,           -- event name, or a path where * matches any characters
    created_at INTEGER NOT NULL,           -- unix ms
    UNIQUE (site_id, kind, value)
);
