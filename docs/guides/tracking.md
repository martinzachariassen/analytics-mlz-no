# Tracking your site

> **TL;DR** — Add one tag to every page:
>
> ```html
> <script defer src="https://analytics.example.com/api/script.js" data-site="SITE_ID"></script>
> ```
>
> Page views (including single-page-app navigation) and outbound link clicks are tracked
> automatically. For custom events, add `data-mlz-event="name"` to an element or call
> `window.mlz?.track("name", { ... })`. No cookies, about 1.1 KB gzipped. Where JavaScript cannot
> run (a GitHub README, an email), turn on the [tracking pixel](#tracking-pixel-no-javascript).

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
window.mlz?.track("signup", { plan: "pro", seats: 3 });
```

Use optional chaining (`?.`): the script loads with `defer`, so `window.mlz` does not exist until
it has run, and is never defined when the visitor blocks it.

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
| `data-allow-localhost="true"` | Also track on a developer's machine: `localhost`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `[::1]` and `file:` pages |
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

The page URL without its query string (only `utm_*` tags are kept), the referrer's origin and,
for custom events, a name and properties. Clicks on links to
other sites send an `outbound-link` event with the link's origin and path, never its query string
or fragment. The server reduces all of this to the fields listed in [privacy.md](../privacy.md).
The script reads and writes no cookies.

## Page views in single-page apps

`history.pushState` and `history.replaceState` are wrapped, and `popstate` is observed, so router
navigations and redirects count as page views. A page restored from the back-forward cache counts
again. The same URL twice in a row is counted once. With `data-hash="true"`, `hashchange` counts
too and the fragment is sent; the server keeps it only when it looks like a route (`#/docs`,
`#!/docs`).

Nothing the script does can throw into your page: a failure to send is swallowed.

## Tracking pixel (no JavaScript)

> **TL;DR** — Turn on **Tracking pixel** in the site's settings, then embed
> `![](https://analytics.example.com/api/pixel.gif?site=SITE_ID&p=/readme)` in Markdown or an
> `<img>` in HTML. Each load counts as a page view (or, with `&e=name`, a custom event). You get
> view counts, not visitors.

Some places show images but strip scripts: GitHub and GitLab READMEs, package registry pages,
emails and newsletters, forums. There the script never runs, but an image still loads, and the
pixel counts that load.

1. In the dashboard, open the site's **Settings** and switch on **Tracking pixel**. It is off by
   default: an image request has no `Origin`, so anyone who knows the site id could send fake
   views to it, and the setting keeps that confined to sites that want the pixel. Use a
   separate site for it (for example `github.example.com`) to keep its numbers apart from your
   website's.
2. Copy a snippet from the same card, or write one:

   ```markdown
   ![](https://analytics.example.com/api/pixel.gif?site=SITE_ID&p=/readme)
   ```

   ```html
   <img src="https://analytics.example.com/api/pixel.gif?site=SITE_ID&p=/welcome&e=email-open&utm_campaign=launch" alt="" width="1" height="1">
   ```

3. Open the page and watch **Realtime**.

Parameters: `p` (path, default `/`), `e` (event name; makes it a custom event that
[goals](../concepts.md#glossary) can count), `ref` (referrer hostname) and the three `utm_`
tags. The full reference is in [api.md](../reference/api.md#get-apipixelgif).

> **Never put personal data in the URL.** An email address, a name or a per-recipient id in `p`,
> `e` or a `utm_` tag would turn anonymous counts into tracking of individual people, which this
> tool is built not to do (see [privacy.md](../privacy.md#tracking-pixel)). Use one URL per
> campaign, not per recipient. Tracking whether an email was opened may also need the
> recipient's consent under the ePrivacy rules where you send it.

**What you get, and what you don't.**

| | Script | Pixel, loaded directly | Pixel, through GitHub, Gmail or Yahoo Mail |
|---|---|---|---|
| Page views, custom events, UTM | Yes | Yes | Yes |
| Referrer | Automatic | `ref`, or the embedding page when the browser sends it | `github.com` / `mail.google.com` / `mail.yahoo.com`, or `ref` |
| Country, browser, OS, device | Yes | Yes | No (shown as "Unknown") |
| Unique visitors, bounce rate, duration | Yes | Roughly | No |
| SPA navigation, outbound links, properties | Yes | No | No |

GitHub fetches every README image through its image proxy (Camo), and Gmail and Yahoo Mail
through their own.
The server then sees the proxy, not the reader, so it stores no country or device for those
views, and all of them share one visitor id. The pixel is served with `no-store`, so the proxies
fetch it again on most views, but a proxy or mail client may still cache it now and then, and
some mail clients load images before anyone opens the email. Treat the numbers as a trend, not
an exact count.

**Apple Mail counts as opened on delivery.** With Mail Privacy Protection, Apple fetches every
image in the background when the email arrives, through its own servers, whether or not the
recipient opens it. Its user agent is just `Mozilla/5.0`, so the server cannot tell it apart: the
view is counted with device "other" and a country near Apple's server. Opens are therefore
inflated by the share of recipients on Apple Mail. Other mail services that proxy images with an
ordinary browser user agent (HEY, for example) are counted as normal visitors with the proxy's
country and browser.

For readers of a normal website who block JavaScript, a `<noscript>` pixel next to the script
works too, once the pixel is on:

```html
<noscript><img src="https://analytics.example.com/api/pixel.gif?site=SITE_ID&p=/pricing" alt="" width="1" height="1"></noscript>
```

## How it works

<details>
<summary>Size, browser support and caching</summary>

- About 2.1 KB minified, 1.1 KB gzipped, no dependencies. CI fails if the gzipped script grows
  past 1100 bytes.
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

The script does nothing when `navigator.webdriver` is set. A prerendered page (Speculation
Rules) is counted only when the visitor actually navigates to it.
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
- [Pixel API (`GET /api/pixel.gif`)](../reference/api.md#get-apipixelgif)
