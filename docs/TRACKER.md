# Tracking script

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

Options and custom events are described in the [README](../README.md#tracking-your-site).

## Size and caching

- About 2.4 KB minified, 1.2 KB gzipped, no dependencies.
- Served with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` and an `ETag`, so
  an update reaches visitors within about an hour.
- Served with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`,
  so it can be loaded from any site.

## Content Security Policy

If your site sets a CSP, allow the analytics host for the script and for the event request:

```
script-src  https://analytics.example.com;
connect-src https://analytics.example.com;
```

## Do Not Track and opt-out

- `data-respect-dnt="true"` skips visitors who have Do Not Track enabled.
- `localStorage.setItem("mlz_ignore", "true")` excludes your own browser.

## What it sends

The page URL, the referrer and, for custom events, a name and properties. The server reduces this
to the fields listed in [PRIVACY.md](PRIVACY.md). The script reads and writes no cookies.

## Building from source

The script is built from `apps/tracker/` into `apps/server/internal/script/script.js`, which is committed
and embedded in the Go binary. Run `make tracker` after changing `apps/tracker/src`. CI fails if the
committed file is out of date.
