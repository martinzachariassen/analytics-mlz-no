package store

import (
	"fmt"
	"slices"
	"strings"
)

// Filter narrows statistics to traffic matching Dim Op Value.
type Filter struct {
	Dim   string // one of FilterDims
	Op    string // one of FilterOps
	Value string
}

// Filters is a set of filters combined with AND.
type Filters []Filter

// FilterDims are the dimensions that can be filtered on.
var FilterDims = []string{
	"path", "hostname", "entry", "exit", "referrer", "utm_source", "utm_medium", "utm_campaign",
	"country", "browser", "os", "device", "event",
}

// FilterOps are the supported operators.
var FilterOps = []string{"is", "is_not", "contains"}

// Validate reports the first invalid filter.
func (fs Filters) Validate() error {
	for _, f := range fs {
		if !slices.Contains(FilterDims, f.Dim) {
			return fmt.Errorf("unknown filter dimension %q", f.Dim)
		}
		if !slices.Contains(FilterOps, f.Op) {
			return fmt.Errorf("unknown filter operator %q", f.Op)
		}
	}
	return nil
}

// Has reports whether fs filters on dim.
func (fs Filters) Has(dim string) bool {
	return slices.ContainsFunc(fs, func(f Filter) bool { return f.Dim == dim })
}

// Filter kinds decide how a filter applies to rows of the events table.
//
//   - visitor dims (country, browser, os, device) are constant within a visit,
//     so they apply to each row directly.
//   - page dims (path, hostname) apply to page views directly when counting
//     page views, and to whole visits ("visits that viewed the page") when
//     computing visit metrics.
//   - visit dims (entry, exit, sources) are attributes of a visit, taken from
//     its first (or last) page view.
//   - event (custom event name) selects visits in which the event happened.
var (
	visitorCols = map[string]string{"country": "country", "browser": "browser", "os": "os", "device": "device"}
	pageCols    = map[string]string{"path": "path", "hostname": "hostname"}
	visitCols   = map[string]string{
		"entry": "path", "exit": "path", "referrer": "referrer_host",
		"utm_source": "utm_source", "utm_medium": "utm_medium", "utm_campaign": "utm_campaign",
	}
)

// cond returns "col op ?" and its argument. col must come from a whitelist.
func cond(col, op, value string) (string, any) {
	switch op {
	case "is_not":
		return col + " != ?", value
	case "contains":
		r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
		return col + ` LIKE ? ESCAPE '\'`, "%" + r.Replace(value) + "%"
	default:
		return col + " = ?", value
	}
}

// scope is the set of event rows a query looks at: one site, one range,
// narrowed by filters.
type scope struct {
	site    string
	r       Range
	filters Filters
}

const inRangeSQL = `site_id = ? AND ts >= ? AND ts < ?`

func (sc scope) rangeArgs() []any {
	return []any{sc.site, sc.r.From.UnixMilli(), sc.r.To.UnixMilli()}
}

// rows returns a WHERE condition (without the keyword) for rows of the
// unaliased events table. With visits=false, page filters apply to each
// page view (for page view counts); with visits=true they select whole visits
// (for visit metrics such as bounce rate and duration).
func (sc scope) rows(visits bool) (string, []any) { return sc.rowsOf("", visits) }

// rowsOf is rows for the events table under alias (empty for none).
func (sc scope) rowsOf(alias string, visits bool) (string, []any) {
	p := ""
	if alias != "" {
		p = alias + "."
	}
	parts := []string{p + "site_id = ? AND " + p + "ts >= ? AND " + p + "ts < ?"}
	args := sc.rangeArgs()
	for _, f := range sc.filters {
		switch {
		case visitorCols[f.Dim] != "":
			c, a := cond(p+visitorCols[f.Dim], f.Op, f.Value)
			parts = append(parts, c)
			args = append(args, a)

		case pageCols[f.Dim] != "" && !visits:
			c, a := cond(p+pageCols[f.Dim], f.Op, f.Value)
			parts = append(parts, p+"type = 'pageview' AND "+c)
			args = append(args, a)

		case pageCols[f.Dim] != "", f.Dim == "event":
			// Visits that contain a matching page view or event. "is not"
			// means visits that contain none.
			col, typ := pageCols[f.Dim], "pageview"
			if f.Dim == "event" {
				col, typ = "name", "event"
			}
			op, in := f.Op, "IN"
			if op == "is_not" {
				op, in = "is", "NOT IN"
			}
			c, a := cond(col, op, f.Value)
			parts = append(parts, p+`session_id `+in+` (SELECT session_id FROM events WHERE `+
				inRangeSQL+` AND type = '`+typ+`' AND `+c+`)`)
			args = append(args, sc.rangeArgs()...)
			args = append(args, a)

		case visitCols[f.Dim] != "":
			// SQLite returns the other columns from the row holding MIN/MAX(ts).
			agg := "MIN(ts)"
			if f.Dim == "exit" {
				agg = "MAX(ts)"
			}
			c, a := cond("v", f.Op, f.Value)
			parts = append(parts, p+`session_id IN (SELECT session_id FROM (
				SELECT session_id, `+visitCols[f.Dim]+` AS v, `+agg+`
				FROM events WHERE `+inRangeSQL+` AND type = 'pageview' GROUP BY session_id) WHERE `+c+`)`)
			args = append(args, sc.rangeArgs()...)
			args = append(args, a)
		}
	}
	return strings.Join(parts, " AND "), args
}
