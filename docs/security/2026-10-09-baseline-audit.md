# Security scan and baseline audit — 2026-10-09

Method: five scanners over the repository at `a83ceca` (gitleaks over the full
history, semgrep `p/default`, osv-scanner, trivy misconfiguration, zizmor), every
result confirmed by reading the code, and the seven baseline controls checked
against the code and the live production response. Nothing was fixed while
auditing; the fixes landed afterwards in #148.

---

## Summary

| # | Item | Status at audit | After #148 |
|---|------|-----------------|------------|
| F1 | The deploy job holds the Cloudflare token while running actions on mutable tags and `npm ci` install scripts | **Medium** | Actions pinned to commit SHAs, checkout credentials not persisted, Dependabot cooldown. Token scope to be confirmed in the dashboard |
| F2 | Opening a shared link replaced the visitor's saved workspace 800 ms later | **Low–Medium** | Fixed; covered by `web/src/app/useSession.test.ts` |
| F3 | `npm audit --audit-level=high` failed: `sharp@0.35.4` (via `wrangler` → `miniflare`), `source-map-js@1.2.1` (via `vite`, `jsdom`); development tooling only | **Low** (blocked merging) | `sharp` overridden to 0.35.5, `source-map-js` 1.2.2; `npm audit` clean |
| F4 | Dependabot proposed releases the day they were published | Low | 7-day cooldown on every ecosystem |
| F5 | Checkouts left `GITHUB_TOKEN` in `.git/config` while third-party code ran | Low | `persist-credentials: false` everywhere |
| F6 | CI actions on mutable tags (read-only jobs) | Low | Pinned with F1 |
| F7 | `golang.org/x/mod@0.38.0` (GO-2026-6179, GO-2026-6180); `x/crypto/openpgp` (GO-2026-5932) | Info — not reachable | `x/mod` 0.40.0; openpgp has no fix and is never imported, ignored with its reason in `core/osv-scanner.toml` |
| F8 | `github-script` expanded a step output into JavaScript | Info — value was regex-constrained | Passed through `env` |
| 1 | Secrets in environment variables | **OK** | — |
| 2 | CORS | **OK** | — |
| 3 | Backend validation | **N/A — structural** | — |
| 4 | Input sanitization and storage | **OK** | — |
| 5 | Rate limiting | **OK** — proven in the local Workers runtime, not re-provoked on the edge | — |
| 6 | Row level security | **N/A — structural** | — |
| 7 | Content Security Policy | **PARTIAL** — accepted exception `style-src-attr 'unsafe-inline'` | Exception recorded in [the security model](README.md#baseline-controls) |

Of the 4,518 raw results, 4,463 came from trivy and semgrep reading the
Terraform under `fixtures/`, `core/internal/analyzer/testdata/` and a local
spike directory: sample input the analyzer draws, never applied to any account.
They are excluded from the semgrep job (`.semgrepignore`) rather than "fixed".

---

## Findings

### F1 — Deploy token reachable by third-party code

`deploy.yml` scoped the token to the steps that use it, but earlier steps in the
same job ran four actions by mutable tag and `npm ci`, which executes every
package's install scripts. Anything that ran there could replace
`node_modules/.bin/wrangler` and read the token when the deploy step called it,
then publish arbitrary code to production — including a page that sends
learners' Terraform elsewhere, the one thing this product promises never to do.

Already mitigating: fork and Dependabot pull requests receive no Actions
secrets, and production deploys only from a push to `main` after CI passes
(`deploy.yml`, job `if:`), so a malicious change had to be merged first.

`npm ci --ignore-scripts` was considered and left out: it risks the native
binaries esbuild and workerd install, and pinning, the cooldown and a narrowly
scoped token cover the realistic path.

### F2 — A shared link erased saved work

`useSession` documented that a shared link leaves stored work untouched. In
fact the save subscription was registered on mount, `fill()` wrote the linked
files through `workspace.write()`, each write emitted a change, and the debounced
save replaced the stored workspace. Anyone could erase a learner's saved work by
sending a link. The shared workspace is now saved only once the visitor edits
it; the test fails without the fix.

### F3 — npm advisories

Both packages are build and development tooling; `npm audit --omit=dev` was
already clean. The `wrangler` release that brings `sharp` 0.35.5 was a day old,
inside the cooldown introduced by the same change, so `sharp` is overridden
instead (see [docs/development.md](../development.md#dependency-overrides)).

---

## Controls

**1. Secrets — OK.** gitleaks over the tree and the full history: no leaks. The
application and the Worker read no environment variables (`wrangler.jsonc` has
no `vars`); the deployment credentials are GitHub Actions secrets passed as
`env:` to single steps.

**2. CORS — OK.** `deploy/headers.ts` deletes `Access-Control-Allow-Origin`;
the live response carries none (`curl -sSI https://terravisual.cloudils.com/`).

**3. Backend validation — N/A.** No backend
([ADR-0001](../adr/0001-client-only-architecture.md)); the Worker answers `405`
to anything but `GET` and `HEAD` (`deploy/worker.ts`).

**4. Sanitization — OK.** No `innerHTML`, `dangerouslySetInnerHTML`, `eval` or
`new Function` in shipped code; paths are confined (`web/src/workspace/paths.ts`);
share links are refused above `2 × 32 KiB` before decompression and capped while
decompressing (`web/src/persistence/share.ts`); imported files are size-checked
before they are read and every write goes through the workspace limits
(`web/src/workspace/workspace.ts`).

**5. Rate limiting — OK, with one caveat.** 1000 requests a minute per
`CF-Connecting-IP`, failing open by design (`wrangler.jsonc`,
`deploy/rate-limit.ts`). It was proven by being tripped in the local Workers
runtime with the limit lowered to five
([deployment notes](../deployment/README.md#the-rate-limit)); it has not been
re-provoked on Cloudflare's edge, which would bill requests and needs the
owner's approval.

**6. Row level security — N/A.** No database and no server-held user data.

**7. CSP — PARTIAL (accepted).** Read off the live response, and
`scripts/check-headers.mjs https://terravisual.cloudils.com --strict-tls`
passed: `default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, a
per-response style nonce, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`, HSTS with preload, `nosniff`, `Referrer-Policy: no-referrer`.
The exception is `style-src-attr 'unsafe-inline'`, required by React Flow's
inline positioning. There is no HTML injection sink to exploit it, and with
`default-src 'none'` an injected style attribute can load nothing from another
origin.

---

## Not verified

- **The Cloudflare token's scope** — visible only in the Cloudflare dashboard.
- **The rate limit on the edge** — see control 5.
- **Branch protection and required checks** — needs the repository's admin settings.

## Follow-ups

- **Go 1.27.2.** `govulncheck` lists 13 standard-library advisories in Go
  1.27.0, the version `core/go.mod` pins and CI builds the shipped
  WebAssembly with. None is called by the analyzer (`govulncheck`, native and
  `GOOS=js GOARCH=wasm`: "Your code is affected by 0 vulnerabilities"). 1.27.2
  was released on 2026-10-08, inside the one-week cooldown; move to it once the
  week has passed.
- **Remove the `sharp` override** once `miniflare` requests 0.35.5 or later.
