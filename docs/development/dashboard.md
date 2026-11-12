# Dashboard development

> **TL;DR** — `apps/web` is a React 19 single-page app built with Vite. It talks only to the Go
> API through the typed client in `src/lib/api.ts`. All view state (period, comparison, filters,
> open detail sheet) lives in the URL and is read through one hook, `useScope`. Data comes from
> TanStack Query hooks in `src/lib/queries.ts`. Styling is Tailwind v4 with design tokens in
> `src/index.css`. shadcn components are generated, so restyle them from CSS and don't edit them.

**Read this if:** you are going to change the dashboard. Time: about 15 minutes.

## The basics

```sh
make dev                                  # API + dashboard on :5173 + demo site, seeded data
cd apps/web
npm run typecheck && npm run lint         # what CI checks
npm test                                  # vitest unit tests
```

The Vite dev server proxies `/api` to `http://localhost:8080` (override with `API_PROXY`). In
production, Firebase Hosting does the same rewrite, so the dashboard always calls the API on its
own origin. That is required for the `__session` cookie and the CSRF model.

| Technology | Used for |
|---|---|
| React 19 + React Router | UI and routes (`createBrowserRouter` in `src/main.tsx`) |
| TanStack Query | Fetching, caching, refetching |
| Tailwind v4 + shadcn/ui (`radix-nova` style) | Styling and base components |
| Recharts, cmdk, sonner | Charts, the <kbd>⌘K</kbd> menu, toasts |

## Where things are

```
src/
  main.tsx               routes, QueryClient
  index.css              design tokens and shadcn restyling
  lib/
    api.ts               typed API client and all response types
    queries.ts           useStats, useBreakdown
    use-scope.ts         URL state: period, compare, interval, filters, detail
    period.ts            period presets, ranges, intervals, time zone
    dims.ts              labels and formatting per dimension, DIM_VIEW
    metrics.ts           METRICS: label, help text, how to read and format each number
    format.ts            numbers, durations, percentages, countries
  routes/
    home.tsx             sign-in page, "Open demo dashboard"
    app-layout.tsx       auth check + sidebar shell
    sites.tsx            site list
    settings.tsx         site settings, tracking snippet
    site/layout.tsx      top bar: period, comparison, filters
    site/overview.tsx    overview
    site/realtime.tsx    realtime
    site/report.tsx      Pages, Sources, Locations, Devices (REPORTS) and Events
  components/
    ui/                  shadcn-generated, do not edit
    *.tsx                app primitives (below)
```

### Routes

| URL | Component |
|---|---|
| `/` | `HomePage` (sign in) |
| `/sites` | `SitesPage` |
| `/sites/:id` | `SiteLayout` → `OverviewPage` |
| `/sites/:id/realtime` | `RealtimePage` |
| `/sites/:id/pages`, `sources`, `locations`, `devices` | `ReportPage` with `report=` |
| `/sites/:id/events` | `EventsPage` |
| `/sites/:id/settings` | `SettingsPage` |

Everything under `/sites` is wrapped in `AppLayout`, which fetches `/api/auth/me` and sends you
to `/` when you are not signed in. Site views are lazy-loaded.

## State lives in the URL

`useScope()` (`src/lib/use-scope.ts`) is the single source of view state for every site view.
It reads and writes these query parameters:

| Parameter | Example | Meaning |
|---|---|---|
| `period` | `30d`, `custom` | A preset from `lib/period.ts`, or `custom` with `from`/`to` |
| `from`, `to` | `2026-10-01` | Custom range, inclusive days in the browser's time zone |
| `compare` | `year`, `off` | Comparison. Missing means `previous` |
| `interval` | `day`, `week` | Chart bucket. Ignored if not allowed for the range |
| `f` (repeated) | `country:is:NO` | Filters, `dim:op:value`. One per dimension and operator |
| `detail` | `path:/blog` | The open detail sheet |
| `tab` | `utm_source` | The tab in a report view (read in `report.tsx`) |

It returns the parsed state, a ready-made `scope` object for API calls, actions (`setPeriod`,
`addFilter`, `openDetail`, …) and `search`, the query string without `detail`. Use `search` in
links between views so the period and filters follow the user.

Do not keep this kind of state in `useState`. If it should survive a reload or a shared link,
it belongs in the URL.

## Data fetching

- `useStats(siteId, scope, interval)` and `useBreakdown(siteId, scope, dim, opts)` in
  `lib/queries.ts`. The query key includes the whole scope, so changing a filter refetches.
  `placeholderData: keepPreviousData` keeps the old numbers on screen while new ones load.
- Defaults in `main.tsx`: `staleTime` 30 s, two retries for network and `5xx` errors, none for
  `4xx`. A `401` from any query re-checks `/api/auth/me`, which sends the user to sign-in.
- Realtime refetches every 10 s, the sidebar's live counts every 15 s (`refetchInterval`).
- Changes use `useMutation` around an `api.*` call and invalidate the affected queries on
  success (see `components/add-site-dialog.tsx`).

Every request goes through `request()` in `lib/api.ts`, which uses same-origin credentials,
sends JSON and throws `ApiError` with the status code.

## App primitives

Use these before writing new layout:

| Component | Use |
|---|---|
| `panel.tsx` | The card around every section, with title, actions and `TextTabs` |
| `kpi-strip.tsx` | The row of key numbers with deltas, driven by `METRICS` |
| `traffic-chart.tsx`, `top-series-chart.tsx` | Time series charts |
| `bar-list.tsx` | Ranked list with proportional bars, click to open a detail |
| `data-table.tsx` | Full table with all metrics |
| `report-card.tsx` | A `Panel` with a `BarList` for one dimension, used on the overview |
| `filter-bar.tsx` | Active filters as removable chips |
| `date-range-picker.tsx` | Period, custom range and interval selects |
| `detail-sheet.tsx` | Side sheet for one value, with "Filter dashboard by this" |
| `delta.tsx` | Up/down change, coloured with `--positive`/`--negative` |
| `heatmap.tsx`, `world-map.tsx`, `proportion-strip.tsx`, `sparkline.tsx` | Special charts |

## Look and theming

- Linear/Vercel style, dark first. The theme is set before React loads (`index.html`) and
  switched by `theme-provider.tsx`.
- All colours are tokens in `src/index.css`, defined for light (`:root`) and dark (`.dark`):
  neutral surfaces, one violet `--accent`, `--positive`/`--negative` for deltas, and
  `--series-1` … `--series-6` for categorical charts.
- The series colours have a fixed order, checked for colour vision deficiency in both themes.
  Do not reorder them or add colours without checking again.
- Type is Geist and Geist Mono. `src/styles/mlz-brand.css` only provides the wordmark font.
- shadcn components: add with `npx shadcn@latest add <name>`. Change their look in
  `index.css` through `[data-slot="…"]` selectors, not by editing files in `components/ui/`, so
  they can be regenerated.

## Recipes

### Show a new metric

1. Make sure the API returns it (`Summary` and `Bucket` types in `lib/api.ts`).
2. Add an entry to `METRICS` in `lib/metrics.ts`: label, help text (shown in a tooltip), how to
   read it, how to format it, and `lowerIsBetter`/`average` if they apply.
3. `KpiStrip` and the charts pick it up from there.

### Add a tab to a report view

Add `{ dim, label }` to the right entry in `REPORTS` (`routes/site/report.tsx`). The dimension
needs a label in `DIMS` (`lib/dims.ts`) and a view in `DIM_VIEW`, so the detail sheet links to
the right page. If the dimension is new to the API, start in [backend.md](backend.md#add-a-breakdown-or-filter-dimension).

### Add a report view

1. Add a config to `REPORTS` in `routes/site/report.tsx`.
2. Add a route in `src/main.tsx`: `{ path: "name", element: <ReportPage key="name" report="name" /> }`.
   The `key` makes React reset state when you switch between reports.
3. Add it to `VIEWS` in `components/app-sidebar.tsx`. The sidebar and the <kbd>⌘K</kbd> menu
   both read this list.
4. Point the dimensions to it in `DIM_VIEW`.

## Tests

Unit tests sit next to the code (`lib/*.test.ts`) and run with vitest: URL state parsing, period
maths, formatting, and a check that the theme script in `index.html` is allowed by its hash in
the Content-Security-Policy in `firebase.json`. If you edit that script, update the hash. Put
logic in `lib/` as plain functions when you can, so it is easy to test.

## Next steps

- [API reference](../reference/api.md): what each endpoint returns
- [Backend development](backend.md)
- [Concepts](../concepts.md): what each number means
