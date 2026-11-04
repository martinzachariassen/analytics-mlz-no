CREATE TABLE sites (
    id         TEXT PRIMARY KEY,           -- public id used in the tracking snippet
    name       TEXT NOT NULL,
    domain     TEXT NOT NULL UNIQUE,       -- normalized, e.g. "mlz.no" (subdomains allowed)
    created_at INTEGER NOT NULL            -- unix ms
);

CREATE TABLE events (
    id            INTEGER PRIMARY KEY,
    site_id       TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    ts            INTEGER NOT NULL,        -- unix ms
    type          TEXT    NOT NULL CHECK (type IN ('pageview', 'event')),
    name          TEXT    NOT NULL DEFAULT '',  -- custom event name; empty for pageviews
    hostname      TEXT    NOT NULL DEFAULT '',
    path          TEXT    NOT NULL DEFAULT '',
    referrer_host TEXT    NOT NULL DEFAULT '',
    utm_source    TEXT    NOT NULL DEFAULT '',
    utm_medium    TEXT    NOT NULL DEFAULT '',
    utm_campaign  TEXT    NOT NULL DEFAULT '',
    country       TEXT    NOT NULL DEFAULT '',  -- ISO 3166-1 alpha-2
    browser       TEXT    NOT NULL DEFAULT '',
    os            TEXT    NOT NULL DEFAULT '',
    device        TEXT    NOT NULL DEFAULT '',  -- desktop | mobile | tablet | other
    visitor_id    INTEGER NOT NULL,        -- daily-rotating anonymous hash
    session_id    INTEGER NOT NULL
);

CREATE INDEX events_site_ts      ON events (site_id, ts);
CREATE INDEX events_site_visitor ON events (site_id, visitor_id, ts);
CREATE INDEX events_ts           ON events (ts);

CREATE TABLE event_props (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    key      TEXT    NOT NULL,
    value    TEXT    NOT NULL,
    PRIMARY KEY (event_id, key)
);

CREATE INDEX event_props_key ON event_props (key, value);

-- Daily salts for visitor hashing. Old salts are deleted so hashes cannot be linked across days.
CREATE TABLE salts (
    day  TEXT PRIMARY KEY,                 -- YYYY-MM-DD (UTC)
    salt BLOB NOT NULL
);
