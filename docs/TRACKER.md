# Tracking script

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

Options and custom events are described in the [README](../README.md#tracking-your-site).

## Size and caching

- About 1.7 KB minified, 0.9 KB gzipped, no dependencies.
- Served gzip-compressed when the browser accepts it (compressed once at startup).
- Targets ES2022 (Chrome/Edge 94+, Firefox 93+, Safari 15.4+). Older browsers fail to parse it and
  are simply not counted; the page itself is unaffected.
- Served with `Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`
  and an `ETag`, so an update reaches visitors within about an hour. `s-maxage` lets a CDN in front
  (Firebase Hosting) answer script requests without reaching the server.
- Served with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`,
  so it can be loaded from any site.

## Content Security Policy

If your site sets a CSP, allow the analytics host for the script and for the event request:

```
script-src  https://analytics.example.com;
connect-src https://analytics.example.com;
```

## Events from HTML

```html
<button data-mlz-event="signup" data-mlz-event-plan="pro">Sign up</button>
```

A click on the element (or anything inside it) sends the event `signup` with the property
`plan: "pro"`. Further `data-mlz-event-*` attributes become more properties in camelCase. The
prefix keeps the attributes apart from your own and from other tools, which is also what makes it
safe to run two analytics tools side by side. An element with `data-mlz-event` is not also counted
as an outbound link. From JavaScript, use `window.mlz.track("signup", { plan: "pro" })`.

## Bots and automation

The script does nothing when `navigator.webdriver` is set and does not count prerendered pages.
The server drops known bots and non-browser clients; see [BOTS.md](BOTS.md).

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
