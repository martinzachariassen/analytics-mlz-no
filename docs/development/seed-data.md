# Seed data: what to test where

> **TL;DR** — `make dev` seeds `data/dev.db` with four demo sites whose synthetic traffic touches
> every dashboard feature: long tails, several hostnames, campaigns, unknown countries and
> devices, events with and without properties, pixel views, a spam burst, a goal nobody reaches,
> a site that has gone quiet and one with no events at all. The table below is the manual test
> list: each row names the data and where it shows. Start over with `make dev-reset && make dev`.

**Read this if:** you want to try a feature locally, or you are adding one and need data for it.

## The sites

| Site | Domain | What it is for |
|---|---|---|
| Fjord Labs Blog (demo) | `localhost` | Most features: about 80 visits a weekday over two years, pixel on, a spam burst. The demo site on <http://localhost:8081> sends real events to it |
| Fjord Labs Docs (demo) | `docs.localhost` | A second profile: GitHub and search traffic, a `search` event with many values, wildcard goals |
| Old Portfolio (demo) | `old.localhost` | Traffic stops 45 days ago: the stale sparkline in the site list, "last event" in settings, an empty Realtime |
| Side Project (demo) | `side.localhost` | No events: the onboarding screen ("Waiting for the first event…") with the snippet |

Sites that already exist keep their data. To get data added in a newer version, run
`make dev-reset` (it deletes `data/dev.db`), then `make dev`. The data comes from
`apps/server/internal/devdata` with a fixed random seed, so two fresh seeds are the same.
Only the "now" moves.

## Feature by feature

| Feature | Data | Where to look |
|---|---|---|
| KPIs, deltas, traffic chart, intervals | Growth over two years, quieter weekends, a July dip, a quiet Christmas | Overview. Switch the period to 12 months and the comparison to "year" |
| Insights and spikes | A Hacker News spike 20 days ago on the blog, reddit on the docs | Overview, "Last 30 days" |
| Realtime | 3–6 visitors in the last minutes, then `seed -live` adds at least one visit a minute per site | Realtime (blog and docs; Old Portfolio stays empty) |
| Pages report, pagination and search | About 150 blog paths and 70 docs paths in a long tail, more than one page of 100 rows. One unicode path (`/blog/ærlig-talt-om-sqlite`) and one very long path | Pages; search for `sqlite` |
| Entry and exit pages | Visits of one to five pages | Pages → Entry, Exit |
| Hostnames | Blog: about 8% on `www.localhost`, 2% on `staging.localhost` | Pages → Hostnames |
| Referrers | Ten big referrers and a tail of about 40 small ones | Sources; the overview card's "more" |
| UTM source, medium, campaign | Blog: `newsletter/email/monthly`, `autumn-launch` from newsletter and Mastodon, `linkedin/social/launch`, and `podcast` with no medium or campaign. Docs: `github/referral/readme`, `newsletter/email/docs-update` | Sources → UTM tabs |
| Countries and map | About 25 countries on every continent, and about 2% unknown | Locations; the world map |
| Devices, browsers, systems | Desktop, mobile, tablet and `other` (a TV), ChromeOS, Samsung Browser, Opera, Vivaldi, and about 1% that the parser does not know | Devices. "Unknown" rows |
| Custom events and properties | `contact-submit{topic}`, `newsletter-signup{position}`, `plan-selected{plan,seats}` (two keys), `signup-start` (no properties), `copy-code{lang}`, `search{query}` (docs, many values), `outbound-link{url}` | Events; open an event for its properties |
| Goals | Blog: `newsletter-signup`, `contact-submit`, `/contact`, and `/pricing/enterprise`, which nobody visits, so zero conversions. Docs: `copy-code`, `/docs/*`, and `/docs/*/install` (the wildcard in the middle) | Overview → Goals; Settings → Goals |
| Visits split by the session timeout | About 1% of visits pause longer than 30 minutes before the next page, so they count as two visits | Visits vs visitors on the overview |
| Tracking pixel | Blog has **Tracking pixel** on. README views of `/readme` through GitHub's proxy (`github.com`), and a monthly `email-open` event through Gmail's (`mail.google.com`, `utm_campaign=monthly`). Like real proxy traffic, they have no country, browser, OS or device | Pages → `/readme`; Events → `email-open`; Settings → Tracking pixel |
| Purging spam | Three days ago at 03:12, one visitor requests `/wp-login.php`, `/.env`, `/xmlrpc.php` and other admin paths 48 times in 20 minutes | Pages, then remove them with `analytics events purge` (below) |
| Onboarding | Side Project has no events | Open it from the site list |
| A site that has gone quiet | Old Portfolio's last visit was 45 days ago | Site list sparkline; Settings → last event |
| CSV export | All of the above | The "CSV" button on any report or the overview chart |

## Try a purge

```sh
DATABASE_PATH=data/dev.db go run ./apps/server/cmd/analytics sites list    # the blog's id
DATABASE_PATH=data/dev.db go run ./apps/server/cmd/analytics events purge \
  -site <blog-id> -from <date three days ago> -to <the day after> -path /wp-login.php
```

The flags are in [cli.md](../reference/cli.md#events-purge).

## Not covered

- **More than one dashboard user.** `DEV_LOGIN` always signs in as `dev`. Testing access with
  several users needs GitHub sign-in ([self-hosting](../guides/self-hosting.md)).
- **Tracker behaviour** (SPA navigation, hash routes, `data-mlz-event-*`, the bot check). That
  goes through the real script, so use the demo site on <http://localhost:8081> instead.

## Adding data for a new feature

Put it in `apps/server/internal/devdata`. Visits and events come from the profiles (`Blog`,
`Docs`, `Portfolio`) and `maybeEvent`, and site-level extras are flags in `devdata.Options`.
The sites, their goals and settings are listed in `demoSites` in
`apps/server/cmd/analytics/main.go`. Then do three things:
- Add a row to the table above.
- Add a check to `TestSeedCoverage` in `devdata_test.go`.
- Keep the e2e tests in mind. They seed 60 days (`apps/web/playwright.config.ts`) and find
  sites by name, so a new site's name must not contain an existing one's.

## Next steps

- [Getting started](../getting-started.md): the tour of the dashboard with this data.
- [CLI reference](../reference/cli.md#seed): every `seed` flag.
