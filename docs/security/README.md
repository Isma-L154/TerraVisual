# Security

TerraVisual analyses Terraform inside the browser and sends nothing anywhere.
That is the product's central promise, and most of what is written here exists
to keep it true rather than merely stated.

## Audits

| Date | Report | Outcome |
|------|--------|---------|
| 2026-09-08 | [Baseline audit](2026-09-08-baseline-audit.md) | 3 OK, 2 N/A (structural), 2 PARTIAL |

Audits are run against seven baseline controls: secrets handling, CORS, backend
validation, input sanitization and storage, rate limiting, row-level security,
and Content Security Policy. Each control is reported as OK, PARTIAL, MISSING,
N/A or UNVERIFIED, and each answer has to cite a file and line or a command and
its output. A control is never marked present because a library that could
provide it is installed.

## When to re-run

On a trigger, not on a calendar:

- before the first production deployment;
- when a new exposed surface appears — an endpoint, a binding, a stored value;
- after introducing authentication, an API, or persistence beyond the browser;
- when a dependency that touches parsing, storage or the network changes;
- before a major release.

## What the pipeline checks on every run

These are continuous, so an audit measures what changed rather than what was
always true:

- `npm audit` on both workspaces, and `govulncheck` on every Go module;
- Dependency Review on pull requests, which blocks a new vulnerable dependency
  before it is merged;
- `scripts/check-headers.mjs` against a **real deployed response** after every
  deployment, so a security header that stopped being served fails the build
  rather than the user.

## The promise, precisely

Source code, imported projects and share links never reach a server. Parsing,
evaluation, layout and rendering all happen on the page, and `connect-src 'self'`
means the browser itself would refuse an attempt to send them elsewhere.

Two honest limits on that:

- **A share link contains the code.** There is no server holding it, so the
  workspace travels compressed in the URL fragment — never sent in the HTTP
  request, but readable by anyone holding the link.
- **Browser extensions are outside this boundary.** An extension you install has
  permission to read every page, and Chrome exempts extension scripts from a
  page's Content Security Policy. Nothing a website can do changes that.

## Reporting something

Privately, through
[a security advisory](https://github.com/Isma-L154/TerraVisual/security/advisories/new)
rather than a public issue. The full policy is in
[SECURITY.md](../../SECURITY.md).
