package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/martinzachariassen/analytics-mlz-no/apps/server/internal/text"
)

// Errors returned by the goal methods.
var (
	ErrGoalExists  = errors.New("this goal already exists")
	ErrGoalInvalid = errors.New("a goal is an event name, or a path starting with /")
	ErrGoalLimit   = fmt.Errorf("a site can have at most %d goals", MaxGoals)
)

// Limits on goals. Every goal adds two aggregates to the GoalStats query.
const (
	MaxGoals         = 50
	maxGoalEventLen  = 64   // as ingest truncates event names
	maxGoalPathLen   = 1024 // as ingest truncates paths
	goalKindEvent    = "event"
	goalKindPath     = "path"
	goalPathWildcard = "*"
)

// Goal is what counts as a conversion: a custom event by name, or a page view whose path
// matches Value, where * matches any run of characters (including /).
type Goal struct {
	ID        int64
	SiteID    string
	Kind      string // "event" or "path"
	Value     string
	CreatedAt time.Time
}

// normalizeGoal cleans and cuts the value the way ingest does with what it stores, so a
// goal typed as sent matches the stored events, and checks it against the kind.
func normalizeGoal(kind, value string) (string, error) {
	value = strings.TrimSpace(text.Clean(value))
	switch kind {
	case goalKindEvent:
		value = text.Truncate(value, maxGoalEventLen)
		if value == "" {
			return "", ErrGoalInvalid
		}
	case goalKindPath:
		// Paths may contain # (hash-router routes) and ? (decoded from %3F) like stored ones.
		value = text.Truncate(value, maxGoalPathLen)
		if !strings.HasPrefix(value, "/") {
			return "", ErrGoalInvalid
		}
	default:
		return "", ErrGoalInvalid
	}
	return value, nil
}

// ListGoals returns a site's goals, oldest first.
func (s *Store) ListGoals(ctx context.Context, siteID string) ([]Goal, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, site_id, kind, value, created_at FROM goals WHERE site_id = ? ORDER BY id`, siteID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := []Goal{}
	for rows.Next() {
		var g Goal
		var created int64
		if err := rows.Scan(&g.ID, &g.SiteID, &g.Kind, &g.Value, &created); err != nil {
			return nil, err
		}
		g.CreatedAt = time.UnixMilli(created).UTC()
		out = append(out, g)
	}
	return out, rows.Err()
}

// CreateGoal adds a goal to a site. It returns ErrGoalInvalid for a bad kind or value,
// ErrGoalExists for a duplicate and ErrGoalLimit when the site has MaxGoals already.
func (s *Store) CreateGoal(ctx context.Context, siteID, kind, value string) (Goal, error) {
	value, err := normalizeGoal(kind, value)
	if err != nil {
		return Goal{}, err
	}
	g := Goal{SiteID: siteID, Kind: kind, Value: value, CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	// The limit check and the insert are one statement, so concurrent requests cannot
	// overshoot it.
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO goals (site_id, kind, value, created_at)
		 SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM goals WHERE site_id = ?1) < ?5`,
		siteID, kind, value, g.CreatedAt.UnixMilli(), MaxGoals)
	if isUniqueViolation(err) {
		return Goal{}, ErrGoalExists
	}
	if err != nil {
		return Goal{}, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return Goal{}, err
	} else if n == 0 {
		return Goal{}, ErrGoalLimit
	}
	if g.ID, err = res.LastInsertId(); err != nil {
		return Goal{}, err
	}
	return g, nil
}

// DeleteGoal removes one of a site's goals; ErrNotFound if the site has no such goal.
func (s *Store) DeleteGoal(ctx context.Context, siteID string, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM goals WHERE site_id = ? AND id = ?`, siteID, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// GoalResult is how often one goal was reached.
type GoalResult struct {
	Goal        Goal
	Visitors    int64 // distinct visitors who reached the goal
	Completions int64 // matching events or page views
}

// GoalStats is the conversion data for a range: Visitors, the same number Summary reports,
// is the denominator for each goal's conversion rate.
type GoalStats struct {
	Visitors int64
	Goals    []GoalResult
}

// globPattern turns a goal path into a GLOB pattern in which only * is special.
func globPattern(path string) string {
	return strings.NewReplacer("[", "[[]", "?", "[?]").Replace(path)
}

// goalCond returns a condition matching the rows that reach g, and its argument. The SQL
// itself comes only from constants.
func goalCond(g Goal) (string, any) {
	if g.Kind == goalKindEvent {
		return `(type = 'event' AND name = ?)`, g.Value
	}
	if strings.Contains(g.Value, goalPathWildcard) {
		return `(type = 'pageview' AND path GLOB ?)`, globPattern(g.Value)
	}
	return `(type = 'pageview' AND path = ?)`, g.Value
}

// GoalStats counts, for each goal, the visitors who reached it and how often, in one pass
// over the range. Filters select whole visits, as for the event breakdown: with a path
// filter, a conversion counts when it happened in a visit that viewed the page.
func (s *Store) GoalStats(ctx context.Context, siteID string, r Range, f Filters, goals []Goal) (GoalStats, error) {
	out := GoalStats{Goals: make([]GoalResult, len(goals))}
	dest := make([]any, 0, 1+2*len(goals))
	dest = append(dest, &out.Visitors)
	for i, g := range goals {
		out.Goals[i].Goal = g
		dest = append(dest, &out.Goals[i].Visitors, &out.Goals[i].Completions)
	}
	query, args := goalStatsSQL(siteID, r, f, goals)
	err := s.db.QueryRowContext(ctx, query, args...).Scan(dest...)
	return out, err
}

// goalStatsSQL selects the visitors as Summary counts them, then two aggregates per goal.
func goalStatsSQL(siteID string, r Range, f Filters, goals []Goal) (string, []any) {
	sc := scope{site: siteID, r: r, filters: f}
	vwhere, args := sc.rows(false)
	cols := make([]string, 0, 1+2*len(goals))
	// Without INDEXED BY the planner walks the covering events_site_visitor index over the
	// site's whole history instead of seeking the range.
	cols = append(cols, "(SELECT COUNT(DISTINCT visitor_id) FROM events INDEXED BY events_site_ts WHERE "+vwhere+")")
	for _, g := range goals {
		c, a := goalCond(g)
		cols = append(cols, "COUNT(DISTINCT CASE WHEN "+c+" THEN visitor_id END)", "COALESCE(SUM("+c+"), 0)")
		args = append(args, a, a)
	}
	where, wargs := sc.rows(true)
	// #nosec G202 -- cols and where are built from constants; values are placeholders.
	return `SELECT ` + strings.Join(cols, ", ") + ` FROM events WHERE ` + where, append(args, wargs...)
}
