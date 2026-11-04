package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode"

	"golang.org/x/net/idna"
	sqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// Errors returned by the store.
var (
	ErrNotFound       = errors.New("not found")
	ErrDomainTaken    = errors.New("a site with this domain already exists")
	ErrDomainRequired = errors.New("domain is required")
	ErrDomainInvalid  = errors.New("domain must be a hostname such as example.com")
)

// Limits on site fields.
const (
	maxDomainLen = 253
	maxNameLen   = 100
)

// Site is a tracked website.
type Site struct {
	ID        string
	Name      string
	Domain    string
	CreatedAt time.Time
}

// NormalizeDomain turns user input like "https://www.Example.com/" or "ærø.no" into the
// lowercase ASCII hostname ingest compares against ("example.com", "xn--r-1fa8s.no").
// It returns "" for input that is not a hostname.
func NormalizeDomain(in string) string {
	d := strings.ToLower(strings.TrimSpace(in))
	if i := strings.Index(d, "://"); i >= 0 {
		d = d[i+3:]
	}
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	if i := strings.LastIndex(d, ":"); i >= 0 && !strings.Contains(d, "]") {
		d = d[:i]
	}
	d = strings.TrimSuffix(strings.TrimPrefix(d, "www."), ".")
	if d == "" {
		return ""
	}
	ascii, err := idna.Lookup.ToASCII(d)
	if err != nil || !validDomain(ascii) {
		return ""
	}
	return ascii
}

// validDomain accepts lowercase ASCII hostnames with at least one dot, plus "localhost" and
// its subdomains for local development. A bare TLD would match every site under it.
func validDomain(d string) bool {
	if d == "" || len(d) > maxDomainLen {
		return false
	}
	for i := 0; i < len(d); i++ {
		c := d[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '.' && c != '-' {
			return false
		}
	}
	return d == "localhost" || strings.HasSuffix(d, ".localhost") || strings.Contains(d, ".")
}

// ValidSiteID reports whether id has the shape of an id this store generates.
func ValidSiteID(id string) bool {
	if len(id) != siteIDLen {
		return false
	}
	for i := 0; i < len(id); i++ {
		if !strings.ContainsRune(idAlphabet, rune(id[i])) {
			return false
		}
	}
	return true
}

func cleanName(name, domain string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" {
		return domain
	}
	if len(name) > maxNameLen {
		name = strings.ToValidUTF8(name[:maxNameLen], "")
	}
	return name
}

func normalizeInput(name, domain string) (string, string, error) {
	if strings.TrimSpace(domain) == "" {
		return "", "", ErrDomainRequired
	}
	d := NormalizeDomain(domain)
	if d == "" {
		return "", "", ErrDomainInvalid
	}
	return cleanName(name, d), d, nil
}

// CreateSite adds a new site and returns it.
func (s *Store) CreateSite(ctx context.Context, name, domain string) (Site, error) {
	name, domain, err := normalizeInput(name, domain)
	if err != nil {
		return Site{}, err
	}
	site := Site{ID: newID(siteIDLen), Name: name, Domain: domain, CreatedAt: time.Now().UTC()}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO sites (id, name, domain, created_at) VALUES (?, ?, ?, ?)`,
		site.ID, site.Name, site.Domain, site.CreatedAt.UnixMilli())
	if err != nil {
		if isUniqueViolation(err) {
			return Site{}, ErrDomainTaken
		}
		return Site{}, err
	}
	s.sites.clear()
	return site, nil
}

// GetSite returns a site by id. Results, including "not found", are cached briefly.
func (s *Store) GetSite(ctx context.Context, id string) (Site, error) {
	now := time.Now()
	if site, found, ok := s.sites.get(id, now); ok {
		if !found {
			return Site{}, ErrNotFound
		}
		return site, nil
	}
	site, err := s.getSite(ctx, id)
	switch {
	case err == nil:
		s.sites.put(id, site, true, now)
	case errors.Is(err, ErrNotFound):
		s.sites.put(id, Site{}, false, now)
	}
	return site, err
}

func (s *Store) getSite(ctx context.Context, id string) (Site, error) {
	var site Site
	var created int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, domain, created_at FROM sites WHERE id = ?`, id).
		Scan(&site.ID, &site.Name, &site.Domain, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Site{}, ErrNotFound
	}
	if err != nil {
		return Site{}, err
	}
	site.CreatedAt = time.UnixMilli(created).UTC()
	return site, nil
}

// ListSites returns all sites ordered by name.
func (s *Store) ListSites(ctx context.Context) ([]Site, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, domain, created_at FROM sites ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var sites []Site
	for rows.Next() {
		var site Site
		var created int64
		if err := rows.Scan(&site.ID, &site.Name, &site.Domain, &created); err != nil {
			return nil, err
		}
		site.CreatedAt = time.UnixMilli(created).UTC()
		sites = append(sites, site)
	}
	return sites, rows.Err()
}

// Site ids: 12 characters from an alphabet without look-alikes (no 0/o, 1/l).
const (
	idAlphabet = "abcdefghijkmnopqrstuvwxyz23456789"
	siteIDLen  = 12
)

// newID draws each character uniformly: bytes that would bias the modulo are redrawn.
func newID(n int) string {
	const limit = 256 - 256%len(idAlphabet)
	out := make([]byte, 0, n)
	buf := make([]byte, 2*n)
	for len(out) < n {
		_, _ = rand.Read(buf) // crypto/rand.Read never returns an error
		for _, b := range buf {
			if int(b) < limit {
				out = append(out, idAlphabet[int(b)%len(idAlphabet)])
				if len(out) == n {
					break
				}
			}
		}
	}
	return string(out)
}

// UpdateSite changes a site's name and domain. An empty domain keeps the current one; an
// empty name defaults to the domain.
func (s *Store) UpdateSite(ctx context.Context, id, name, domain string) (Site, error) {
	if strings.TrimSpace(domain) == "" {
		current, err := s.getSite(ctx, id)
		if err != nil {
			return Site{}, err
		}
		domain = current.Domain
	}
	name, domain, err := normalizeInput(name, domain)
	if err != nil {
		return Site{}, err
	}
	res, err := s.db.ExecContext(ctx, `UPDATE sites SET name = ?, domain = ? WHERE id = ?`, name, domain, id)
	if err != nil {
		if isUniqueViolation(err) {
			return Site{}, ErrDomainTaken
		}
		return Site{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Site{}, ErrNotFound
	}
	s.sites.clear()
	return s.getSite(ctx, id)
}

// DeleteSite removes a site and all its events.
func (s *Store) DeleteSite(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sites WHERE id = ?`, id)
	if err != nil {
		return err
	}
	s.sites.clear()
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var se *sqlite.Error
	return errors.As(err, &se) && se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}
