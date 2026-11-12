# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on the repository
(<https://github.com/martinzachariassen/analytics-mlz-no/security/advisories/new>).

Do not open a public issue or pull request for a security problem. Include what you found, how to
reproduce it and which version or commit you tested.

You can expect an acknowledgement within a few days. This is a personal project maintained in spare
time, so there is no guaranteed fix time, but confirmed issues in the areas below are prioritised
and you will be credited in the release notes unless you prefer otherwise.

## Supported versions

Until 1.0, only the latest release receives fixes. After 1.0, the latest minor version.

## In scope

- Authentication and session handling (GitHub OAuth, the `__session` cookie, CSRF protection).
- Authorisation: reading or changing another user's sites or statistics.
- The event ingestion endpoint: injection, denial of service by small requests, bypassing the
  per-site hostname check or rate limit.
- Anything that causes IP addresses or raw user agents to be stored or leaked.
- SQL injection, XSS in the dashboard, and the served tracking script.

## Threat model

Ingestion is public by design: the site id and endpoint are in every page's HTML, and anything a
browser sends, a script can send too. No tracker without sign-in can prove an event is genuine. What
the server guarantees instead:

- **No access.** Public endpoints can only add events. Reading statistics or changing sites needs a
  GitHub sign-in from the allowlist (OAuth with PKCE, 7-day sliding sessions, allowlist checked on
  every request). SQL uses a whitelist of dimensions and bound parameters. The dashboard is
  single-tenant: every allowlisted user can read and change every site, and changes are logged
  with the user who made them.
- **Only valid, safe data is stored.** The site must exist, and the page URL and `Origin` must be on
  its domain. Lengths, property counts and types are capped, control characters and bidi overrides
  are stripped, and referrers must be plain hostnames. The dashboard renders everything as text
  under a strict Content-Security-Policy, and CSV exports prefix any cell that starts with `=`,
  `+`, `-`, `@`, tab or carriage return with `'`, so a sent path or event name cannot run as a
  spreadsheet formula.
- **Limited inflation from one source.** Limits apply per upstream address (which cannot be
  forged), per client IP, and per visitor (site plus daily hash). Limiter keys are parsed
  addresses, never raw header text, and the maps that hold them are bounded. Bots and the excess
  per visitor get a silent `202`.
- **Floods do not take the service down or run up a bill.** There is a global event rate, a bounded
  write queue that answers `503` instead of piling up, a database size cap that pauses ingestion
  but keeps the dashboard working, the script cached at the CDN, and a single Cloud Run instance.
- **Spam can be removed.** `POST /api/sites/{id}/purge` (signed in), or
  `analytics events purge -site ID -from … -to … [-path …]` on the host.
- **What ships is what was reviewed.** Base images and the Litestream binary are pinned by digest,
  GitHub Actions by commit. CI scans the image with Trivy (accepted findings are listed with a
  reason and an expiry in `.trivyignore.yaml`) and runs CodeQL, `govulncheck` and `bun audit`.
  Releases carry an SBOM and signed build provenance, and Dependabot keeps every ecosystem
  current.

What is not prevented: a distributed attack from many real IP addresses with browser-like
requests can still add plausible-looking events, at up to the global rate. Purge them afterwards.

## Out of scope

- Findings that need an already compromised server, database or GitHub account.
- Volumetric denial of service beyond the built-in limits (network-level floods are the hosting
  platform's job).
- Missing hardening headers on third-party platforms (Firebase Hosting, Cloud Run) you configure yourself.
- Event spam that stays within the limits above: ingestion is public by design, as with any
  analytics tool (see the threat model).
