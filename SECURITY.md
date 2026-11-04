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

## Out of scope

- Findings that need an already compromised server, database or GitHub account.
- Volumetric denial of service.
- Missing hardening headers on third-party platforms (Firebase Hosting, Cloud Run) you configure yourself.
- Event spam: ingestion is public by design, as with any analytics tool, and is limited to the site's registered domain.
