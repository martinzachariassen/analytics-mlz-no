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
./scripts/verify.sh lint web e2e          # what CI checks: Biome, types, tests, build, end to end
cd apps/web
bun run typecheck
bun run test                              # vitest: unit and component tests
bun run e2e                               # Playwright + axe (starts its own server, see Tests)
bunx playwright test --ui                 # the same, step by step in a browser
```

Packages come from `bun install` at the repository root (one Bun workspace for `apps/web` and
`apps/tracker`). Formatting and linting is Biome (`biome.json` at the root); `make format` fixes
both TypeScript and Go.

TypeScript runs in strict mode with `noUncheckedIndexedAccess`: `rows[0]` is `Row | undefined`,
so handle the empty case instead of asserting it away with `!`.

**Size budget.** After the production build, `bun run check-size` (`check-size.mjs`, part of
the `web` verify group) fails when gzipped output grows past its budget: the JavaScript
`index.html` loads before the first render (entry script plus its `modulepreload`s) 215 KB, all
CSS 25 KB, any single lazy chunk 125 KB, all JavaScript 450 KB. Keep heavy libraries in lazy
routes or `lazy()` components (charts and the world map already are). If a budget has to grow,
raise it in `check-size.mjs` and say why in the PR.

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
    error-page.tsx       root errorElement: reloads once on a stale chunk, else shows the error
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

Both route trees have `ErrorPage` as `errorElement`. After a deploy, an open tab may ask for a
lazy chunk that no longer exists; `ErrorPage` then reloads once (remembered in
`sessionStorage`) so the user gets the new build. Any other error shows a real error page
instead of React Router's default.

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

URL parameters are untrusted input. Look values up with `Object.hasOwn(TABLE, key)`, never
`key in TABLE`: `?period=toString` or `?metric=constructor` pass an `in` check and crash the page.
Filters beyond `MAX_FILTERS` (10, the API's limit) are dropped instead of turning into a `400`.

## Data fetching

- `useStats(siteId, scope, interval)` and `useBreakdown(siteId, scope, dim, opts)` in
  `lib/queries.ts`. The query key includes the whole scope, so changing a filter refetches.
  `placeholderData: keepPreviousData` keeps the old numbers on screen while new ones load.
- Defaults in `main.tsx`: `staleTime` 30 s, two retries for network errors, `5xx` and `429`
  (the rate limiter refills within a second), none for other `4xx` (`shouldRetry` in
  `lib/api.ts`). A `401` from any query re-checks `/api/auth/me`, which sends the user to
  sign-in.
- Realtime refetches every 10 s, the sidebar's live counts every 15 s (`refetchInterval`).
- `useSite(siteId)` polls every 5 s (`WAITING_POLL_MS`) while the site's `first_event_at` is
  `null`, and stops once data has arrived; the site list does the same while any site is
  waiting.
- Changes use `useMutation` around an `api.*` call and invalidate the affected queries on
  success (see `components/add-site-dialog.tsx`).

Every request goes through `request()` in `lib/api.ts`, which uses same-origin credentials,
URL-encodes the site id, sends JSON and throws `ApiError` with the status code (the message falls
back to `HTTP <status>`, because HTTP/2 has no status text). A `401` during a mutation is handled
by `MutationCache.onError` the same way as for queries.

**Error states.** A failed query shows `<ErrorNote>` (`components/error-note.tsx`) with the
message, never a skeleton that loads forever. Use it in every new view and panel: check
`isError` before `isPending`. Pass the queries themselves: `ErrorNote` renders nothing until one
of them fails, then shows the first failure, and its "Try again" button refetches every query
that failed (not the healthy ones). Give one note all the queries a view depends on, so a retry
never leaves one of them broken:

```tsx
<ErrorNote queries={[stats, rows]} />
```

Panels below that note that need a failed query render `<Unavailable />` instead of their
skeleton, so the failure is announced once and nothing waits forever. A panel with its own
query (the heatmap, the overview map, the per-value series in `TopSeriesChart`) shows its own
`ErrorNote` in place of the content.

Only a click counts as retrying: the alert reads "Retrying…" until the refetches settle, so a
retry that fails again is announced again, while background polls and refreshes leave it alone.
The button uses `aria-disabled` rather than `disabled` during a retry so keyboard focus stays on
it. `error` alone shows a message without a button, for panels whose query already has a note
with a retry elsewhere on the page. `title` replaces "Could not load this" (the app shell uses
"Could not reach the server").

**Onboarding.** A site that has never received an event has nothing to chart, so
`routes/site/layout.tsx` shows `<WaitingForData>` (`components/waiting-for-data.tsx`) instead of
any view: a live "Waiting for the first event…" status, the snippet, and what to check if nothing
arrives. When polling sees `first_event_at`, the layout swaps in the dashboard and toasts "First
event received". Settings shows the same status (with "Site added." after `?new=1`, then
"Receiving data" with a link to the dashboard) and "Last event … ago" once there is data. The
site list shows "Waiting for first event" and skips the stats request for such sites. Use
`first_event_at === null` for "never had data" and the usual "Nothing in this period" for an
empty period.

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
- shadcn components: add with `bunx shadcn@latest add <name>` (in `apps/web`). Change their look
  in `index.css` through `[data-slot="…"]` selectors, not by editing files in `components/ui/`,
  so they can be regenerated. Biome does not format or lint that folder.

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

## Building and hosting

`make web` builds into `apps/web/dist`. `make deploy-web` publishes it to Firebase Hosting.

| Setting | Where | Effect |
|---|---|---|
| `TRACKER_ORIGIN` | `make web TRACKER_ORIGIN=https://t.example.com` (becomes `VITE_TRACKER_ORIGIN`) | The host the **Tracking code** snippet points at. Without it, the dashboard's own origin |
| `Cache-Control` | `firebase.json` | `no-cache` for every path (so `/` and deep links always get the latest `index.html`), and `immutable` for the hashed files under `/assets/**` and `/fonts/**`. Firebase matches header rules on the request path and the last match wins |
| Security headers | `firebase.json` | CSP (`img-src 'self' data:`, so no third-party images such as GitHub avatars; the menu shows initials), HSTS, `X-Frame-Options`, `Permissions-Policy` |

The Vite dev server uses `strictPort`, so it fails instead of moving to another port when 5173
is taken (the server's `PUBLIC_URL` points at 5173).

## Tests

There are three layers. Each one catches what the one before cannot.

| Layer | Where | Runs with | What it covers |
|---|---|---|---|
| Unit | `src/lib/*.test.ts` | `bun run test` (vitest, Node) | The API client (error mapping, retry policy, headers, id encoding, query strings), URL state parsing and the `hasOwn` guards, period maths, metrics, dimensions, formatting, and the CSP hash of the theme script |
| Component | `src/components/*.test.tsx`, `src/routes/**/*.test.tsx` | `bun run test` (vitest, happy-dom, Testing Library) | Filter bar, date range picker and its shortcuts, detail sheet, `ErrorNote` (retry, focus, no flip on background refetches) and onboarding in the site layout (polling until the first event, then the dashboard), against a mocked `fetch`, with the URL as the observable state |
| End to end | `e2e/*.spec.ts` | `bun run e2e` (Playwright) | The real Go server with seeded data and the production build: sign-in, every view of a site, filters, the detail sheet, settings, a failed request recovering with "Try again", and a new site waiting for its first event and switching to the dashboard when one is sent, with an axe scan on every page |

- **Unit tests:** put logic in `lib/` as plain functions when you can, so it is easy to test. If
  you edit the theme script in `index.html`, update its hash in `firebase.json`; `csp.test.ts`
  checks it.
- **Component tests:** opt into a DOM with `// @vitest-environment happy-dom` at the top of the
  file. `src/test/render.tsx` has `renderInSite`, which renders a component inside `/sites/:id`
  with a fresh query client and returns the router so tests can assert on the URL, and
  `mockFetch`, which answers API paths with fixed JSON.
- **End-to-end tests:** `playwright.config.ts` seeds a throwaway database in the system temp
  directory (`seed -reset -days 60`), runs the server on :18080 with `DEV_LOGIN=1`, and serves
  `apps/web/dist` with `vite preview` on :4173, so it can run next to `make dev`. Both are
  started fresh every run, so a leftover process on either port fails the run instead of
  testing old code. `bun run e2e` builds the dashboard first; `verify.sh` skips that when its
  `web` group has just built it.
  - A setup project signs in once and shares the session, because the auth endpoints are rate
    limited.
  - Every test runs three times: desktop, mobile (Pixel 7) and the light theme.
  - `expectAccessible` fails on serious or critical WCAG 2.1 AA violations. Fix the cause (a
    token in `src/index.css`, a role, a label); don't exclude the rule.
  - To test a failure, fail the request with `page.route(…)` and `route.fulfill({ status: 500 })`;
    remember the query retries 5xx twice with backoff before the error shows.
  - On failure, `apps/web/test-results/` holds a trace (`bunx playwright show-trace …`). CI
    uploads it as the `playwright-traces` artifact.

## Next steps

- [API reference](../reference/api.md): what each endpoint returns
- [Backend development](backend.md)
- [Concepts](../concepts.md): what each number means
