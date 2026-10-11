# Security

TerraVisual analyses Terraform inside the browser and sends nothing anywhere.
That is the product's central promise, and most of what is written here exists
to keep it true rather than merely stated.

## Audits

| Date | Report | Outcome |
|------|--------|---------|
| 2026-09-08 | [Baseline audit](2026-09-08-baseline-audit.md) | 3 OK, 2 N/A (structural), 2 PARTIAL. The `style-src` finding was fixed on 2026-09-09 (#56); the report records the fix rather than erasing the finding |
| 2026-10-09 | [Security scan and baseline audit](2026-10-09-baseline-audit.md) | 4 OK, 2 N/A (structural), 1 PARTIAL (the accepted `style-src-attr` exception). Eight scanner findings, the most serious a supply-chain path to the deploy token and a shared link that erased saved work; all addressed in #148 |

Audits are run against seven baseline controls: secrets handling, CORS, backend
validation, input sanitization and storage, rate limiting, row-level security,
and Content Security Policy. Each control is reported as OK, PARTIAL, MISSING,
N/A or UNVERIFIED, and each answer has to cite a file and line or a command and
its output. A control is never marked present because a library that could
provide it is installed.

## Baseline controls

What each of the seven controls means for this project, decided once. A change
that adds a backend, an API, accounts or server-side storage reopens the two
that are N/A.

| Control | Decision |
|---------|----------|
| Secrets in environment variables | Applies. The application and the Worker read no secrets and no environment variables, so there is no `.env.example`; the deployment credentials are GitHub Actions secrets exposed only to the steps that use them |
| CORS | Applies. There is no API to call from elsewhere, and the Worker deletes any `Access-Control-Allow-Origin` header (`deploy/headers.ts`) |
| Backend validation | **N/A.** There is no backend ([ADR-0001](../adr/0001-client-only-architecture.md)); the Worker serves static assets to `GET` and `HEAD` only. Untrusted input — Terraform, imported folders, share links — is bounded and validated in the browser and the analyzer instead |
| Input sanitization and storage | Applies, client-side: no HTML sinks, paths confined to the workspace, share links size-checked before and while decompressing, imports size-checked before reading |
| Rate limiting | Applies at the one layer that exists, the Worker: 1000 requests a minute per address, failing open. Per-account limits do not apply because there are no accounts |
| Row level security | **N/A.** There is no database and no server-held user data; each visitor's workspace stays in their own IndexedDB |
| Content Security Policy | Applies, set from code and checked on the live response after every deployment. Accepted exception: `style-src-attr 'unsafe-inline'`, because React Flow positions nodes with inline style attributes that no nonce can cover; with `default-src 'none'`, an injected style attribute can load nothing from another origin |

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
- the [Security workflow](../../.github/workflows/security.yml): gitleaks over
  the full history, semgrep, osv-scanner on both lockfiles, and zizmor on the
  workflows themselves. Every suppression sits next to what it suppresses, with
  its reason (`.semgrepignore`, `core/osv-scanner.toml`, inline comments);
- GitGuardian secret scanning on every pull request, as a check from the
  GitGuardian GitHub App installed on the repository rather than a workflow in
  it;
- every action pinned to a commit SHA, checkouts that do not keep the token,
  and Dependabot holding each release back for a week, because the deploy job
  is the one place a secret meets third-party code;
- Dependency Review on pull requests, which blocks a new vulnerable dependency
  before it is merged;
- `scripts/check-headers.mjs` against a **real deployed response** after every
  deployment, so a security header that stopped being served fails the build
  rather than the user;
- a browser suite that loads the application under the policy actually served,
  because the way a stricter policy fails is silently: the header is perfect and
  the page is broken.

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
