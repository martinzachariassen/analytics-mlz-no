# Tracking your site

> **TL;DR** — Add one tag to every page:
>
> ```html
> <script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
> ```
>
> Page views (including single-page-app navigation) and outbound link clicks are tracked
> automatically. For custom events, add `data-mlz-event="name"` to an element or call
> `window.mlz.track("name", { ... })`. No cookies, about 0.9 KB gzipped.

**Read this if:** you want to add analytics to a website, track custom events, or your site uses a
Content Security Policy.

## The basics

1. Create a site in the dashboard (**Add site**) or with `analytics sites add -domain example.com`.
   You get a **site id**.
2. Add the script tag above to every page. Replace the host with your analytics server and
   `SITE_ID` with the id.
3. Open the site in a browser and watch the **Realtime** view in the dashboard.

The site's domain is what the server compares incoming events against. Subdomains are accepted,
so `example.com` also covers `blog.example.com`. Add every other domain as its own site.

> [!TIP]
> Ad blockers often filter hostnames that contain "analytics". Serving the script from a short,
> neutral host such as `t.example.com` helps; see
> [extra domains](deploy-gcp.md#extra-domains).

## Custom events

**From HTML:**

```html
<button data-mlz-event="signup" data-mlz-event-plan="pro">Sign up</button>
```

A click on the element, or on anything inside it, sends the event `signup` with the property
`plan: "pro"`. Each further `data-mlz-event-*` attribute becomes another property, in camelCase:
`data-mlz-event-billing-cycle="yearly"` is sent as `billingCycle`. An element with
`data-mlz-event` is not also counted as an outbound link.

The attributes carry the `mlz` prefix so they never collide with attributes of your own or of
another tool on the page. That also makes it safe to run two analytics tools side by side.

**From JavaScript:**

```js
window.mlz.track("signup", { plan: "pro", seats: 3 });
```

> [!WARNING]
> Event names and properties are stored exactly as sent. Never put personal data (email
> addresses, names, user ids) in them. See [privacy.md](../privacy.md).

## Script options

| Attribute | Description |
|---|---|
| `data-site` | Site id (required) |
| `data-api` | Collection endpoint, if it is not on the same host as the script |
| `data-auto="false"` | Turn off automatic page views and call `mlz.pageview()` yourself |
| `data-hash="true"` | Include the `#hash` in paths (for hash-based routers) |
| `data-allow-localhost="true"` | Also track on `localhost` |
| `data-respect-dnt="true"` | Don't track visitors who have Do Not Track enabled |

## Excluding your own visits

Run `localStorage.setItem("mlz_ignore", "true")` in the browser console on your site. This is the
only thing the script reads from `localStorage`.

## Content Security Policy

If your site sets a CSP, allow the analytics host for the script and for the event request:

```
script-src  https://analytics.example.com;
connect-src https://analytics.example.com;
```

## What it sends

The page URL, the referrer and, for custom events, a name and properties. The server reduces this
to the fields listed in [privacy.md](../privacy.md). The script reads and writes no cookies.

## How it works

<details>
<summary>Size, browser support and caching</summary>

- About 1.7 KB minified, 0.9 KB gzipped, no dependencies.
- Served gzip-compressed when the browser accepts it (compressed once at startup).
- Targets ES2022 (Chrome/Edge 94+, Firefox 93+, Safari 15.4+). Older browsers cannot parse it and
  are simply not counted. The page itself is unaffected.
- Served with `Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`
  and an `ETag`, so an update reaches visitors within about an hour. `s-maxage` lets a CDN in
  front (Firebase Hosting) answer script requests without reaching the server.
- Served with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`,
  so it can be loaded from any site.
</details>

<details>
<summary>Bots and automation</summary>

The script does nothing when `navigator.webdriver` is set, and it does not count prerendered pages.
The server drops known bots and non-browser clients; see [bots.md](../operations/bots.md).
</details>

<details>
<summary>Building from source</summary>

The script is built from `apps/tracker/` into `apps/server/internal/script/script.js`, which is
committed and embedded in the Go binary. Run `make tracker` after changing `apps/tracker/src`.
CI fails if the committed file is out of date.
</details>

## Next steps

- [Privacy: what is stored](../privacy.md)
- [Event API (`POST /api/event`)](../reference/api.md#public)
