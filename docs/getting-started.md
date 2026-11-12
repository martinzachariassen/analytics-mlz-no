# Getting started

> **TL;DR** — Run `mise install && bun install`, then `make dev`, then open <http://localhost:5173> and
> click **Open demo dashboard**. You get two demo sites with two years of synthetic traffic and a
> demo page that sends real events. No accounts, no configuration.

**Read this if:** you have never run the project before. Time: about 10 minutes. At the end you
will have seen every part of the system working, and you will know where to look next.

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| [mise](https://mise.jdx.dev) | any | Installs every other tool at the version pinned in `mise.toml`: Go (the server), Bun and Node (dashboard and tracker), Terraform and the linters |
| Python 3 | any | Serves the demo site (`python3 -m http.server`) |
| Docker | optional | Only to test the production image |

Install the tools and the JavaScript dependencies once:

```sh
mise install    # Go, Bun, Node, Terraform, linters (versions in mise.toml)
bun install     # one Bun workspace for apps/web and apps/tracker; also enables the pre-commit hook
```

## 2. Start everything

```sh
make dev
```

This does three things:

1. `analytics seed` creates `data/dev.db` with two demo sites, "Demo blog" (`localhost`) and
   "Demo docs" (`docs.localhost`), filled with two years of synthetic traffic: growth, weekends,
   seasonal dips, spikes, returning visitors and custom events. On later runs, existing demo
   data is kept.
2. It prints the links:
   ```
     Dashboard:  http://localhost:5173
     Demo site:  http://localhost:8081/?site=<id>
   ```
3. It starts three processes: the API on `:8080` (with `DEV_LOGIN=1`, so sign-in is one click),
   the dashboard dev server on `:5173` (which proxies `/api` to `:8080`) and the demo site on `:8081`.

## 3. Tour of the dashboard

Open <http://localhost:5173> and click **Open demo dashboard**.

| View | What it shows | Try this |
|---|---|---|
| **Overview** | Key numbers with deltas against the previous period, the traffic chart, top pages, sources, locations and devices, active hours | Change the period in the top bar, then switch the comparison to "year" |
| **Realtime** | Visitors in the last 5 minutes, a 30-minute chart, and the current top pages, referrers and countries | Keep it open for step 4 |
| **Pages** | All pages, entry pages, exit pages, hostnames | Click a page to open its detail sheet |
| **Sources** | Referrers and UTM source, medium and campaign | Open a referrer and choose **Filter dashboard by this**. The filter follows you to every view |
| **Locations** | Countries and a world map | |
| **Devices** | Device type, browser, operating system | |
| **Events** | Custom events and their properties | |
| **Settings** | Site name, domain, tracking snippet, delete | |

> [!TIP]
> Everything you choose (period, comparison, interval, filters, an open detail sheet) is stored
> in the URL, so you can bookmark or share any view. Press <kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd> to
> jump between sites and views.

## 4. Send real events

Open the **Demo site** link that `make dev` printed, and click around. Each page view and each
button with `data-mlz-event` is sent through the real tracking script to `POST /api/event`. Within
a few seconds it shows up in **Realtime**.

Or send one by hand. Find the site id with `sites list`, then post an event:

```sh
DATABASE_PATH=data/dev.db go run ./apps/server/cmd/analytics sites list

curl -i -A "Mozilla/5.0" -H "Origin: http://localhost:8081" \
  --data '{"site":"<site-id>","url":"http://localhost:8081/hello"}' \
  http://localhost:8080/api/event
```

`202 Accepted` means it was stored. Try it without `-A` (dropped as a bot, but still `202`) or
without `-H Origin` (`400`) to see the filters at work. Why they behave that way is in
[bots.md](operations/bots.md).

## 5. Look under the hood

- **The API.** The dashboard only uses public JSON endpoints. Open the browser's network tab and
  watch `/api/sites/<id>/stats?...` while you change filters. Every endpoint is described in
  [reference/api.md](reference/api.md).
- **The database.** `sqlite3 data/dev.db '.schema events'` shows the one table that holds all
  traffic. There is no IP column and no user agent column.
- **The code.** [ARCHITECTURE.md](../ARCHITECTURE.md) has the map. A good first read is
  `apps/server/internal/server/server.go` (all routes on one screen), then
  `apps/server/internal/ingest/ingest.go` (what happens to an event).

## 6. Make a change

- **Server:** edit Go code, stop `make dev` with <kbd>Ctrl+C</kbd> and start it again.
- **Dashboard:** edit `apps/web/src`. Vite reloads the browser.
- **Tracking script:** edit `apps/tracker/src`, run `make tracker`, and restart.
- **Before a pull request:** `make verify`, the same checks CI runs. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Start over with fresh data: `make dev-reset && make dev`.

## Next steps

- [Concepts](concepts.md): what every number means
- [Architecture](../ARCHITECTURE.md): the code map
- [Self-hosting](guides/self-hosting.md) or [Deploying to Google Cloud](guides/deploy-gcp.md)
