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
    queries.ts           useStats, useBreakdown, useMe, useRealtime
    keys.ts              isTyping, PERIOD_KEYS and SHORTCUTS (the shortcut help reads them)
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
    settings.tsx         site settings: section nav, tracking, pixel, goals, general, delete
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
to `/` when you are not signed in. A failed first check shows "Could not reach the server"; a
failed background re-check (on window focus) keeps the app and the user's place in it. Site
views are lazy-loaded.

Both route trees have `ErrorPage` as `errorElement`. After a deploy, an open tab may ask for a
lazy chunk that no longer exists; `ErrorPage` then reloads (the time is remembered in
`sessionStorage`) so the user gets the new build. A stale chunk again within a minute means the
reload did not help (offline, a broken deploy), so it shows the error with **Reload** instead of
"Updating…" forever; a later deploy in the same tab reloads by itself again. Any other error
shows a real error page instead of React Router's default.

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
| `pages_tab`, `sources_tab`, `tech_tab`, … | `entry` | The tab of an overview card (`ReportCard`'s `id` plus `_tab`). Missing means the card's first tab |
| `hours` | `pageviews` | The metric of the Active hours heatmap. Missing means visitors |
| `metric` | `pageviews` | The metric the KPI strip picks for the chart: the overview's main chart, and the "Top … over time" chart on report and Events views. Missing means visitors |
| `new` | `1` | Set after **Add site**: the waiting screen says "Site added". Dropped once the site has data |
| `add` | `1` | On `/sites`: opens the Add site dialog (the sidebar's "Add site" link) |
| `auth_error` | `denied` (also `not_allowed`, `conflict`, `state`, `failed`) | On `/`: shows why sign-in failed (`AUTH_ERRORS` in `routes/home.tsx`) |
| `event`, `prop` | `signup`, `plan` | The picked event and property on the Events view. A value that is not in the period's data falls back to the top one |

It returns the parsed state, a ready-made `scope` object for API calls, actions (`setPeriod`,
`addFilter`, `openDetail`, …) and `search`, the query string without `detail`. Use `search` in
links between views so the period and filters follow the user. Presets are worked out again when
the local date changes (`useToday`), so "Today" in a tab left open moves on at midnight.

For a parameter that must be one of a fixed list, use `useParamChoice(key, allowed, fallback?)`
from `use-scope.ts`: it falls back to `fallback` (the first value unless given), leaves that one
out of the URL, and writes through `updateParams`. `useMetricParam()` is the one for `metric`.
The site list keeps its `period` (Today, 7 days, 30 days, 12 months; 7 days by default) the same
way and carries it into each row's link. `sc.search`, the query string carried between views and
sites, leaves out `detail` and `new`.

Change view-specific parameters (`tab`, `metric`, `event`, `prop`) with `sc.updateParams(q => …)`,
not with `setSearchParams`: React Router hands every update the parameters of the last render, so
two updates before the next render (a tab change and closing the sheet) would overwrite each
other. `updateParams` builds each update on the one before it.

Do not keep this kind of state in `useState`. If it should survive a reload or a shared link,
it belongs in the URL.

**Tab titles.** Call `useTitle(...parts)` (`src/lib/use-title.ts`) in a page to set the browser
tab title, for example `Pages · mlz.no · mlz. analytics`. The site layout does it for every site
view and settings; the title goes back to `mlz. analytics` when the page unmounts.

URL parameters are untrusted input. Look values up with `Object.hasOwn(TABLE, key)`, never
`key in TABLE`: `?period=toString` or `?metric=constructor` pass an `in` check and crash the page.
Filters beyond `MAX_FILTERS` (10, the API's limit) are dropped instead of turning into a `400`.

## Data fetching

- `useStats(siteId, scope, interval)` and `useBreakdown(siteId, scope, dim, opts)` in
  `lib/queries.ts`. The query key includes the whole scope, so changing a filter refetches.
  `...keepPreviousFor(view)` keeps the old numbers on screen while new ones load, but only while
  the query shows the same thing: `view` is the key without the scope (site, dimension, event,
  property). A new tab or site starts with a skeleton, so the old tab's rows never appear, and
  can never be clicked, under the new heading.
- Defaults in `main.tsx`: `staleTime` 30 s, two retries for network errors, `5xx` and `429`
  (the rate limiter refills within a second), none for other `4xx` (`shouldRetry` in
  `lib/api.ts`). A `401` from any query re-checks `/api/auth/me`, which sends the user to
  sign-in.
- Realtime refetches every 10 s (`REALTIME_POLL_MS`), the sidebar's live count every 15 s.
  Both use `useRealtime(siteId, detail)`; on the Realtime page the badge reads the page's own
  `detail` query, so there is one poll, not two.
- `useSite(siteId)` polls while the site's `first_event_at` is `null` and stops once data has
  arrived. `waitingPoll` in `lib/queries.ts` sets the pace: every 5 s (`WAITING_POLL_MS`) in
  the first hour after the site was added, then every 60 s (`IDLE_POLL_MS`), so a site that
  was never installed does not keep open tabs busy. `useSites()` polls the list at the pace of
  its fastest waiting site; use it for the site list everywhere (the sidebar and the <kbd>⌘K</kbd>
  menu do), so every view shares one polling rule. Settings uses `useSite(id, { live: true })`, which keeps polling
  every 60 s once there is data, so "Last event … ago" stays current.
- `useGoals(siteId)` and `useGoalStats(siteId, scope)` share the `["goals", siteId]` key
  prefix, so invalidating it after a goal is added or removed refreshes the list, the overview
  card and every "Make this a goal" button.
- Changes use `useMutation` around an `api.*` call and invalidate the affected queries on
  success (see `components/add-site-dialog.tsx`).

Every request goes through `request()` in `lib/api.ts`, which uses same-origin credentials,
URL-encodes the site id, sends JSON and throws `ApiError` with the status code (the message falls
back to `HTTP <status>`, because HTTP/2 has no status text). A `200` whose body is not JSON,
usually an HTML page answering an `/api` path, is an `ApiError` too ("The server sent an
unexpected response"), not a raw `SyntaxError`, and is not retried. A `401` during a mutation is handled
by `MutationCache.onError` the same way as for queries. CSV exports are the exception: `exportUrl` builds plain
`<a download>` links, because the browser sends the session cookie on the same origin and saves
the file under the name the server gives it.

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

**Onboarding.** **Add site** (`components/add-site-dialog.tsx`) lands on the new site's
overview with `?new=1`. A site that has never received an event has nothing to chart, so
`routes/site/layout.tsx` shows `<WaitingForData>` (`components/waiting-for-data.tsx`) instead of
any view: a live "Waiting for the first event…" status ("Site added." in front while `new` is
set), the snippet, custom event examples (`EventSnippets` from `tracking-snippet.tsx`), a link to
the tracking pixel in settings, and what to check if nothing arrives. When polling sees
`first_event_at`, the layout swaps in the dashboard, drops `new` (replacing the history entry,
so Back still leaves the site) and toasts "First event
received". Settings shows "Waiting for the first event…" until then and "Last event … ago" once
there is data. The site list shows "Waiting for first event" and skips the stats request for
such sites. The Events view without any events shows how to send one instead of an empty
table. Use
`first_event_at === null` for "no stored events" and the usual "Nothing in this period" for an
empty period. Onboarding follows the stored events, not history: a site whose events have all
been purged or aged out by `RETENTION_DAYS` shows it again until the next event.

## Layout

- **Overview** (`routes/site/overview.tsx`): the headline (insights, KPI strip, main chart), then
  `Section`s with an `.eyebrow` heading, grouped by the question they answer: *Content and
  acquisition* (pages, sources), *Conversions* (goals, custom events), *Audience* (map,
  countries), *Technology and time* (devices, browsers & OS, active hours at full width).
- **Report and Events views**: the KPI strip picks the metric of the "Top … over time" chart, as
  on the overview. A row in any table, events included, opens the detail sheet; on Events the
  properties panel has its own event picker (`?event=`).
- **Settings** (`routes/settings.tsx`): `SectionNav` (`components/section-nav.tsx`) is a sticky
  column on wide screens and a sideways-scrolling row on narrow ones. It links to `#tracking`,
  `#pixel`, `#goals`, `#general` and `#danger` (delete, last and apart), marks the current one
  with `aria-current`, and scrolls to the hash, which the router does not.
- **Every screen has a `PageHeader`**, including "No such site" and the loading fallback, so the
  sidebar can always be opened on a phone. The comparison picker stays in the header on every
  screen size; below 768 px (`useIsMobile`) the header's controls move from the title row to the
  filter row, so the title keeps its width, and wrap under the filter chips when they don't fit.
  Below 360 px the Filter button shows only its icon and the period picker drops its calendar
  icon, so the header stays two rows on a 320 px phone.
- **Sideways-scrolling rows** (`TextTabs`, `SectionNav`) have no scrollbar; `useScrollFade`
  (`hooks/use-scroll-fade.ts`) fades the edge where more is hidden. A tab scrolls fully into
  view when picked.
- **Panel actions wrap**: a `Panel`'s header controls go to their own line when they don't fit
  next to the title (the event properties panel on a phone). The Goals card drops its
  Conversions column below `sm`.

**Keyboard.** Single keys (periods, <kbd>X</kbd>, <kbd>D</kbd>), <kbd>⌘K</kbd> and <kbd>⌘B</kbd> (sidebar) are listed in
`SHORTCUTS` (`lib/keys.ts`). <kbd>?</kbd>, the ⌘K menu and the user menu open the shortcut help
(`components/shortcuts-dialog.tsx`). The ⌘K menu also switches the comparison (previous period,
year over year, off) and opens the calendar for a custom range (`openRangePicker`); it offers
that only while a period picker is on screen (`useHasRangePicker`), so not on Realtime, Settings
or a site waiting for its first event. Add a new
shortcut to `SHORTCUTS` so it shows up there. `CommandDialog` from shadcn is only the dialog:
the menu puts its own `<Command>` root inside it, which cmdk needs.

**Accessibility beyond axe.** KPI help is a real button (hover, focus or tap opens it) next to
the metric button, not inside it. The heatmap is one tab stop with arrow, Home and End keys, and a
label and tooltip per cell. Charts come with a screen-reader sentence (`chartSummary` in
`traffic-chart.tsx`, the series totals in `top-series-chart.tsx`, the busiest hour in
`heatmap.tsx`). The quick filter button in lists is always there on touch screens.
The date picker's calendar starts a new range on the first click after a full one
(`resetOnSelect`), instead of moving an end of the preset's range.

## App primitives

Use these before writing new layout:

| Component | Use |
|---|---|
| `panel.tsx` | The card around every section, with title, actions and `TextTabs` |
| `kpi-strip.tsx` | The row of key numbers with deltas, driven by `METRICS`; with `onMetric`, each tile picks the chart's metric |
| `traffic-chart.tsx`, `top-series-chart.tsx` | Time series charts |
| `bar-list.tsx` | Ranked list with proportional bars, click to open a detail |
| `data-table.tsx` | Full table with all metrics. Its search filters the loaded rows; `ReportPage` passes `search`/`onSearch` and, when the first page is full (the server may have more), also asks the API with a `contains` filter on the dimension (debounced, not for countries, whose labels the server does not know) |
| `report-card.tsx` | A `Panel` with a `BarList` for one dimension, used on the overview. Its `id` names its tab in the URL |
| `section-nav.tsx` | Anchor links to the sections of a long page (settings) |
| `shortcuts-dialog.tsx` | The keyboard shortcut help, from `SHORTCUTS` |
| `filter-bar.tsx` | Active filters as removable chips |
| `date-range-picker.tsx` | Period, custom range, comparison (`CompareSelect`) and interval selects |
| `detail-sheet.tsx` | Side sheet for one value, with "Filter dashboard by this" and a link to its view on the right tab. Takes a `period` for views without one: on Realtime it shows today, and its view link opens on today too |
| `delta.tsx` | Up/down change, coloured with `--positive`/`--negative` |
| `export-link.tsx` | The "CSV" download in a panel's action slot. Build its `href` with `exportUrl.breakdown`/`exportUrl.timeseries` from `lib/api.ts`, passing the panel's scope so the file matches what is on screen |
| `goals-card.tsx`, `goals-settings.tsx`, `goal-button.tsx` | Conversions per goal on the overview (a row filters by the goal), goal management in settings (`#goals`), and "Make this a goal" in the detail sheet and the event properties panel. `lib/goals.ts` has the labels and the goal-to-filter mapping; `formatRate` in `lib/format.ts` formats conversion rates |
| `heatmap.tsx`, `world-map.tsx`, `proportion-strip.tsx`, `sparkline.tsx` | Special charts |

## Look and theming

- Linear/Vercel style, dark first. The theme is set before React loads (`index.html`) and
  switched by `theme-provider.tsx`.
- All colours are tokens in `src/index.css`, defined for light (`:root`) and dark
  (`[data-theme="dark"]`). The UI is greyscale and colour means data: mlz violet (`--accent`) is
  the main data colour and the brand, grey is the comparison, `--positive`/`--negative` are only
  for up and down, and `--series-1` … `--series-5` are for charts that compare categories.
- The series colours have a fixed order, checked for colour vision deficiency in both themes.
  Do not reorder them or add colours without checking again. Roles, the full palette, the rules
  and how to change a colour: [Colours](colours.md).
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
`make embed-web` copies the build into `apps/server/internal/web/static`, so the next `go build`
embeds it and the server serves the dashboard itself; the Dockerfile and the release workflow do
the same. Without that step (`make run`, `make dev`, `go test`), the binary has no dashboard and
logs so at startup.

Firebase Hosting and the embedded copy answer alike: `internal/web` sets the same headers and
rewrites as `firebase.json`, and `TestMatchesFirebaseHosting` fails when they drift. Change a
header or rewrite in both. HSTS is the exception on the server side: it is sent only when
`PUBLIC_URL` is https. A missing file under `/assets/` or `/fonts/` is a `404` from the server,
where Firebase answers with `index.html`.

| Setting | Where | Effect |
|---|---|---|
| `TRACKER_ORIGIN` | `make web TRACKER_ORIGIN=https://t.example.com` (becomes `VITE_TRACKER_ORIGIN`) | The host the **Tracking code** snippet points at. Without it, the dashboard's own origin |
| `Cache-Control` | `firebase.json` | `no-cache` for every path (so `/` and deep links always get the latest `index.html`), and `immutable` for the hashed files under `/assets/**` and `/fonts/**`. Firebase matches header rules on the request path and the last match wins |
| Security headers | `firebase.json` (mirrored in `apps/server/internal/web/web.go`) | CSP (`img-src 'self' data:`, so no third-party images such as GitHub avatars; the menu shows initials), HSTS, `X-Frame-Options`, `Permissions-Policy` |

The Vite dev server uses `strictPort`, so it fails instead of moving to another port when 5173
is taken (the server's `PUBLIC_URL` points at 5173).

## Tests

There are three layers. Each one catches what the one before cannot.

| Layer | Where | Runs with | What it covers |
|---|---|---|---|
| Unit | `src/lib/*.test.ts`, `src/components/traffic-chart.test.ts` | `bun run test` (vitest, Node) | The API client (error mapping, retry policy, headers, id encoding, query strings), URL state parsing and the `hasOwn` guards, period maths and presets, goals, metrics, dimensions, formatting, where chart buckets end (months, DST days), and the CSP hash of the theme script |
| Component | `src/components/*.test.tsx`, `src/routes/**/*.test.tsx`, `src/lib/*.test.tsx` | `bun run test` (vitest, happy-dom, Testing Library) | Filter bar, date range picker (presets, calendar range, comparison and interval selects, shortcuts), ⌘K menu, shortcut help, theme switching, sidebar (sign out, add site, one realtime poll), KPI strip, heatmap keyboard grid, bar list, data table sorting and search, report cards, top series and world map, insights, goal button, detail sheet, goals (the overview card, adding and removing in settings), settings (rename, delete with confirmation, section nav), site list, `ErrorNote` (retry, focus, no flip on background refetches), onboarding in the site layout (polling until the first event, "Site added", then the dashboard), the `useScope` actions and midnight rollover, which placeholder rows `useBreakdown` keeps, `AppLayout` on a failed re-check, `ErrorPage` reloading after a deploy, Realtime (live data, polling, failure), and copying a snippet, against a mocked `fetch`, with the URL as the observable state |
| End to end | `e2e/*.spec.ts` | `bun run e2e` (Playwright) | The real Go server with seeded data and the production build: sign-in and sign-out, every view of a site, the period, calendar, comparison and interval controls, overview sections and card tabs in the URL, filters, the detail sheet, settings (rename and delete), goals (conversions on the overview, adding and removing in settings), CSV downloads (a filtered table and the time series), keyboard shortcuts, ⌘K and the theme, a failed request recovering with "Try again", a new site waiting for its first event and switching to the dashboard when one is sent, and the real tracking script on a page sending a page view and an event to the server, with an axe scan on every page |

- **Unit tests:** put logic in `lib/` as plain functions when you can, so it is easy to test. If
  you edit the theme script in `index.html`, update its hash in `firebase.json`; `csp.test.ts`
  checks it.
- **Component tests:** opt into a DOM with `// @vitest-environment happy-dom` at the top of the
  file. `src/test/render.tsx` has `renderInSite`, which renders a component inside `/sites/:id`
  with a fresh query client and returns the router so tests can assert on the URL, and
  `mockFetch`, which answers API paths with fixed JSON. A route can also be a function of the
  request's `init` that returns the body or a `Response`, for testing mutations and error
  statuses (see `components/goals.test.tsx`).
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
  - The tracker test serves its page from `page.route` on the API's own origin,
    `http://localhost:18080` (the seeded blog's domain is `localhost`, and Chrome blocks a page on
    another port from reaching the loopback API) with `data-allow-localhost`, and sets `navigator.webdriver`
    to false in an init script: the tracker ignores automated browsers on purpose.
  - Sign-out runs in its own signed-in context: signing out revokes the session, so it must not
    use the shared one.
  - On failure, `apps/web/test-results/` holds a trace (`bunx playwright show-trace …`). CI
    uploads it as the `playwright-traces` artifact.

## Next steps

- [API reference](../reference/api.md): what each endpoint returns
- [Backend development](backend.md)
- [Concepts](../concepts.md): what each number means
