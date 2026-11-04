package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Errors returned by the store.
var (
	ErrNotFound       = errors.New("not found")
	ErrDomainTaken    = errors.New("a site with this domain already exists")
	ErrDomainRequired = errors.New("domain is required")
)

// Site is a tracked website.
type Site struct {
	ID        string
	Name      string
	Domain    string
	CreatedAt time.Time
}

// NormalizeDomain turns user input like "https://www.Example.com/" into "example.com".
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
	return strings.TrimPrefix(d, "www.")
}

// CreateSite adds a new site and returns it.
func (s *Store) CreateSite(ctx context.Context, name, domain string) (Site, error) {
	domain = NormalizeDomain(domain)
	if domain == "" {
		return Site{}, ErrDomainRequired
	}
	if strings.TrimSpace(name) == "" {
		name = domain
	}
	site := Site{ID: newID(12), Name: name, Domain: domain, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sites (id, name, domain, created_at) VALUES (?, ?, ?, ?)`,
		site.ID, site.Name, site.Domain, site.CreatedAt.UnixMilli())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
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

const idAlphabet = "abcdefghijkmnopqrstuvwxyz23456789"

func newID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error
	for i := range b {
		b[i] = idAlphabet[int(b[i])%len(idAlphabet)]
	}
	return string(b)
}

// UpdateSite changes a site's name and domain.
func (s *Store) UpdateSite(ctx context.Context, id, name, domain string) (Site, error) {
	domain = NormalizeDomain(domain)
	if domain == "" {
		return Site{}, ErrDomainRequired
	}
	if strings.TrimSpace(name) == "" {
		name = domain
	}
	res, err := s.db.ExecContext(ctx, `UPDATE sites SET name = ?, domain = ? WHERE id = ?`, name, domain, id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
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
