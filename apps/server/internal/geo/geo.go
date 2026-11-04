// Package geo resolves IP addresses to ISO country codes using a MaxMind-format
// database (e.g. DB-IP Lite Country, https://db-ip.com, CC BY 4.0).
package geo

import (
	"net/netip"

	"github.com/oschwald/maxminddb-golang/v2"
)

// Locator looks up countries. A nil or empty Locator returns "" for every lookup.
type Locator struct {
	db *maxminddb.Reader
}

// Open loads the database at path. An empty path returns a no-op Locator.
func Open(path string) (*Locator, error) {
	if path == "" {
		return &Locator{}, nil
	}
	db, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &Locator{db: db}, nil
}

// Enabled reports whether a database is loaded.
func (l *Locator) Enabled() bool { return l != nil && l.db != nil }

// Country returns the ISO 3166-1 alpha-2 code for ip, or "" if unknown.
func (l *Locator) Country(ip string) string {
	if !l.Enabled() {
		return ""
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ""
	}
	var rec struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if err := l.db.Lookup(addr.Unmap()).Decode(&rec); err != nil {
		return ""
	}
	return rec.Country.ISOCode
}

// Close releases the database.
func (l *Locator) Close() error {
	if !l.Enabled() {
		return nil
	}
	return l.db.Close()
}
