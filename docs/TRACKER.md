# Tracking script

```html
<script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
```

Options and custom events are described in the [README](../README.md#tracking-your-site).

## Size and caching

- About 1.9 KB minified, 1 KB gzipped, no dependencies. CI fails if the gzipped script grows
  past 1024 bytes (`npm run check-size` in `apps/tracker`).
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

The script does nothing when `navigator.webdriver` is set. A prerendered page (Speculation
Rules) is counted only when the visitor actually navigates to it. The server drops known bots and
non-browser clients; see [BOTS.md](BOTS.md).

## Do Not Track and opt-out

- `data-respect-dnt="true"` skips visitors who have Do Not Track enabled.
- `localStorage.setItem("mlz_ignore", "true")` excludes your own browser.

## What it sends

The page URL, the referrer and, for custom events, a name and properties. Clicks on links to
other sites send an `outbound-link` event with the link's origin and path, never its query string
or fragment. The server reduces all of this to the fields listed in [PRIVACY.md](PRIVACY.md). The
script reads and writes no cookies.

## Page views in single-page apps

`history.pushState` and `history.replaceState` are wrapped, and `popstate` is observed, so router
navigations and redirects count as page views. A page restored from the back-forward cache counts
again. The same URL in a row is counted once. With `data-hash="true"`, `hashchange` counts too and
the fragment is sent; the server keeps it only when it looks like a route (`#/docs`, `#!/docs`).

Nothing the script does can throw into your page: a failure to send is swallowed.

## Building from source

The script is built from `apps/tracker/` into `apps/server/internal/script/script.js`, which is committed
and embedded in the Go binary. Run `make tracker` after changing `apps/tracker/src`. CI fails if the
committed file is out of date.
