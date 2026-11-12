# Tracker development

> **TL;DR** — The tracking script is under 200 lines of TypeScript in `apps/tracker/src`.
> `core.ts` has the logic and `index.ts` reads the `<script>` tag. `make tracker` bundles it
> with esbuild into `apps/server/internal/script/script.js`. That file is committed and embedded
> in the Go binary, and CI fails if it is out of date. Keep it under 1 KB gzipped.

**Read this if:** you are going to change what the script collects or how it behaves on a page.
To *use* the script, read [guides/tracking.md](../guides/tracking.md) instead.

## The basics

```sh
bun install                  # once, at the repository root (Bun workspace)
cd apps/tracker
bun run test                 # vitest with happy-dom
bun run typecheck
bun run size                 # build, then check the gzipped size (fails above 1024 bytes)
bun run check-size           # the same check without rebuilding
cd ../.. && make tracker     # build script.js (same as bun run build)
./scripts/verify.sh tracker  # everything CI checks for the tracker
```

After `make tracker`, restart the server (it embeds the file at build time) and commit
`apps/server/internal/script/script.js` together with the source change.

## How it works

| File | Role |
|---|---|
| `src/index.ts` | Entry point. Reads `data-site`, `data-api`, `data-auto`, `data-hash`, `data-allow-localhost`, `data-respect-dnt` from `document.currentScript`, calls `init` and sets `window.mlz` |
| `src/core.ts` | `init(cfg)` returns `{ track, pageview }`. Contains everything else |
| `src/core.test.ts` | Tests for `init` in a fake DOM (happy-dom) |
| `src/index.test.ts` | Tests for the entry point: attribute parsing, the endpoint taken from `script.src`, `data-api`, the double-load guard |
| `check-size.mjs` | Fails if the gzipped `script.js` is larger than 1024 bytes |

What `init` does:

1. **Decides whether to run** (`isDisabled`): not on a developer's machine (`localhost`,
   `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `[::1]`, `file:`) unless allowed, not
   under WebDriver, not with Do Not Track if `data-respect-dnt` is set, not when
   `localStorage.mlz_ignore` is `"true"`.
2. **Sends a page view** on load, except for prerendered pages, which wait until they are shown.
   The referrer is sent with the first page view only.
3. **Follows single-page apps** by wrapping `history.pushState` and `history.replaceState` and
   listening for `popstate` (and `hashchange` with `data-hash`). A page restored from the
   back-forward cache (`pageshow` with `persisted`) counts again. The same URL twice in a row is
   ignored.
4. **Handles clicks** (left and middle): an element with `data-mlz-event` sends a custom event
   with its `data-mlz-event-*` attributes as properties. Otherwise a link to another host sends
   `outbound-link` with the link's origin and path only (no query string, fragment or
   credentials).
5. **Sends** with `navigator.sendBeacon`, falling back to `fetch(..., { keepalive: true })`. The
   body is a JSON string sent as `text/plain`, which avoids a CORS preflight request. `send()` is
   wrapped in `try`/`catch`, so a CSP-blocked beacon or unserialisable props never reach the host
   page's click handler or router.

The payload is `{ site, type, url, name?, referrer?, props? }`. The server does all the
normalisation (path, referrer host, UTM, user agent parsing). The script sends the full URL and
lets the server keep only what it needs.

## Rules

- **No cookies, no storage writes, no fingerprinting.** The only storage read is the
  `mlz_ignore` opt-out. See [privacy.md](../privacy.md).
- **Small.** Check `bun run size` before and after. Every byte is downloaded on every tracked
  page. Prefer removing code to adding options.
- **Never throw on the host page.** Failures to send are swallowed.
- **ES2022** is the build target (Safari 15.4+, Chrome 94+, Firefox 93+).
- A new `data-*` option needs a field in `Config`, parsing in `index.ts`, a test, and a row in
  [guides/tracking.md](../guides/tracking.md#script-options).
- A new payload field needs server support in `ingest.buildEvent` first. See
  [backend.md](backend.md).

<details>
<summary>Advanced: test-only code and the build</summary>

`MLZ_TEST` is a compile-time constant: `true` in `vitest.config.ts`, `false` in the esbuild
command (`--define:MLZ_TEST=false`). Code behind it, such as `stop()` that removes listeners
between tests, is removed from the production bundle by minification.

The build is `esbuild src/index.ts --bundle --minify --format=iife --target=es2022`. The Go
package `internal/script` embeds the result with `//go:embed`, gzips it once at startup, and
serves it with an `ETag` and `Cache-Control: public, max-age=3600`. A change can therefore take
up to an hour (plus CDN caching) to reach visitors.

CI (`.github/workflows/ci.yml`, job `tracker`) runs `./scripts/verify.sh tracker`: typecheck and
tests, a rebuild that fails if the committed `script.js` changed, and then `bun run check-size`.
`make verify` runs the same steps locally.

</details>

## Next steps

- [Tracking guide](../guides/tracking.md): the user-facing options
- [Backend development](backend.md): how the server reads the payload
- [Bots](../operations/bots.md): what the server drops
