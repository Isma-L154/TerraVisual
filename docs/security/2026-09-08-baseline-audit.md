# Baseline security audit — 2026-09-08

Method: reading the code and running commands. Nothing here is inferred from a
configuration file, or from what a dependency is capable of providing.

Nothing was fixed while auditing. Findings that need work are listed at the end
and become their own issues.

---

## Summary

| # | Control | Status | Evidence, in one line |
|---|---------|--------|-----------------------|
| 1 | Secrets in environment variables | **OK** | No credential in the tree or in all 58 commits of history; no runtime environment variable exists to leak; the two deployment secrets are GitHub Actions secrets passed as `env:`, never as arguments |
| 2 | CORS | **OK** (N/A by design, enforced anyway) | No API exists to be called cross-origin, and the Worker actively deletes any `Access-Control-Allow-Origin` an upstream might add — `deploy/headers.ts:73` |
| 3 | Backend validation | **N/A — structural** | There is no backend. The only server-side surface is static asset delivery, whose entire input is a method and a path — `deploy/worker.ts:33-46`. The client-side equivalents are real and are audited under control 4 |
| 4 | Input sanitization and storage | **OK** | No SQL, no shell, no template engine, no deserializer of untrusted data beyond a shape-checked JSON payload; no `innerHTML`, no `dangerouslySetInnerHTML`, no `eval` in shipped code |
| 5 | Rate limiting | **PARTIAL** | Compute limits exist and are proven by tests that trip them; there is **no request-rate limit** on the deployment at any layer this repository controls, and the platform's defaults are UNVERIFIED |
| 6 | Row level security | **N/A — structural** | No database, no server-side storage, no accounts. The only storage is IndexedDB, isolated by the browser per origin and per profile |
| 7 | Content Security Policy | **PARTIAL** | A CSP is served and was read off a real response; `script-src` carries no `unsafe-inline` and uses `wasm-unsafe-eval` rather than `unsafe-eval`, but `style-src` does carry `'unsafe-inline'` |

Two controls are N/A, and both for the same reason: the application has no
backend ([ADR-0001](../adr/0001-client-only-architecture.md)). That decision is
what removes them, and adding a server would bring both back.

---

## 1. Secrets in environment variables — OK

**Nothing hardcoded, in the tree or in history.**

```
$ git grep -nIE "(AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9]{20,}|(api[_-]?key|secret|password|token)\s*[:=]\s*[\"'][^\"']{8,})" -- .
(no matches outside tests and this document)

$ git log --all -p | grep -nE "(AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9]{20,})"
(no matches)

$ git log --oneline --all | wc -l
58
```

History was searched, not only the current tree, because a secret removed in a
later commit is still published. All 58 commits were searched.

**No credential files are tracked.**

```
$ git ls-files | grep -Ei '(^|/)\.env|\.pem$|\.key$|credentials|secret'
(none)
```

**No runtime environment variable exists.** Shipped code reads none:

```
$ grep -rn "import.meta.env\|process\.env" web/src deploy core
(none)
```

That makes several of this control's sub-questions vacuous rather than passed:
there is no `.env.example` because there is nothing to put in it, and "does it
fail loudly when a required variable is missing" has no subject. The project
cannot fall back to a default secret because it holds no secret.

**No secret reaches the client bundle.** The built bundle was scanned directly:

```
$ grep -oE "(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})" web/dist/assets/*.js
(no matches)
```

This is nearly guaranteed by construction — a bundle carrying a secret would
hand it to every visitor — but the control asks, so it was checked rather than
argued.

**The only secrets in the project are deployment credentials**, held as GitHub
Actions repository secrets and referenced in `.github/workflows/deploy.yml:48`,
`:68-69` and `:78-79`. Every one is passed through `env:`, never as a
command-line argument, so none appears in a process listing. The credential
check reads the token only to test whether it is empty, and prints a notice
rather than the value (`deploy.yml:45-56`).

`secrets.PRODUCTION_URL` (`deploy.yml:88`) is a URL, not a credential. It is a
secret only so the workflow file need not name the production hostname; nothing
breaks if it becomes public.

**Corroborated independently.** GitGuardian runs as a check on this repository
and reports `pass` on the pull request carrying this audit. Its agreement is
worth recording, but it is corroboration rather than the finding: a scanner
passing is evidence that two different pattern sets found nothing, not proof
that nothing is there.

**Not verified:** the scope of the Cloudflare API token actually installed.
`docs/deployment/README.md` asks for one scoped to *Workers Scripts: Edit*, but
whether that is what exists can only be seen in the Cloudflare dashboard. See
blind spots.

---

## 2. CORS — OK

There is no API. Cross-origin permission is not merely unset, it is removed:
`deploy/headers.ts:73` deletes `Access-Control-Allow-Origin` from every
response, on the reasoning that an origin allowance nobody needs is one somebody
will eventually rely on.

```
$ grep -rn "Access-Control-Allow" deploy web/src
deploy/headers.ts:73:  headers.delete('Access-Control-Allow-Origin');
deploy/headers.test.ts:  (the test asserting it stays deleted)
```

No wildcard origin, no reflection of the `Origin` header, no `Allow-Credentials`.
Nothing is protected only by a browser's willingness to refuse a cross-origin
request, because nothing is protected at all: every response is a public static
asset.

---

## 3. Backend validation — N/A (structural)

**The structural reason:** there is no backend. Terraform source is parsed and
evaluated in a Web Worker inside the visitor's browser
([ADR-0001](../adr/0001-client-only-architecture.md)), and the deployment Worker
exists only to attach security headers to static files
([ADR-0006](../adr/0006-hosting-cloudflare-workers.md)). It holds no bindings,
no storage and no secrets — `wrangler.jsonc` declares an assets directory and
nothing else.

The single server-side surface accepts a method and a path, and validates the
method: anything other than `GET` or `HEAD` is answered `405` rather than handed
to the asset server to decide (`deploy/worker.ts:36-43`).

The control's real question — *is untrusted input validated before it is
trusted?* — does apply to this project. It just applies on the client, and is
answered under control 4, because here they are the same question.

---

## 4. Input sanitization and storage — OK

None of this control's usual destinations exist:

```
$ grep -rn "dangerouslySetInnerHTML\|\.innerHTML *=\|eval(\|new Function(" web/src deploy core
(no matches)
```

No SQL, because there is no database. No shell, template engine or deserializer
receives user input. Rendering goes through React, which escapes text by
default, and the one route by which raw HTML could enter the DOM is absent.

There are three untrusted inputs, and each is checked before use.

**A shared link, chosen by whoever wrote it.** The only input supplied by a
third party rather than by the person using the tool, so it gets the strictest
handling — every failure yields no workspace rather than a partial one:

- length is bounded *before* decompression (`web/src/persistence/share.ts:82`),
  so a decompression bomb is refused rather than expanded;
- the decoded payload's shape is checked rather than assumed — version, a
  `files` object, every value a string (`share.ts:89-99`);
- every path inside it goes through the same confinement as a path from disk.

Proven by tests that feed it bad input rather than by reading the code
(`web/src/persistence/share.test.ts:59-99`): a non-base64 fragment, data that is
not compressed, a payload of the wrong shape, a payload claiming a future
version, an over-long fragment, and `../../../etc/passwd` as a filename.

**Paths, from an imported project or a shared link.** `normalisePath`
(`web/src/workspace/paths.ts:42-79`) refuses rather than clamps: absolute paths,
control characters, `..` climbing past the root, paths over 1024 characters or
32 segments deep. Windows separators are unified first, so a drag-and-drop from
Explorer cannot use `\` to slip past a check written for `/`. Twelve tests
exercise it, including "still refuses to climb out of the workspace"
(`paths.test.ts:80`).

This matters more than it appears: Terraform's own `module { source = "../.." }`
is a path controlled by the code being analysed, and module resolution passes
through the same confinement in Go (`core/internal/analyzer/modules.go`).

**Imported files.** Selection is by extension and directory
(`web/src/workspace/import.ts:44-90`), which is appropriate here rather than
weak: nothing is executed and nothing is served, so a file that is not Terraform
is skipped and a file that is gets parsed as text. `.tfstate` files are skipped
deliberately, and the interface says why — *"skipped from generated directories
such as .terraform, and state files, which can contain secrets"*
(`import.ts:229-232`). That is the product reducing the chance somebody loads
their own credentials into the editor.

**Storage.** IndexedDB, per origin and per browser profile. Records are
shape-checked when read back (`web/src/persistence/storage.ts:86-95`), so an old
or corrupted record starts an empty session instead of breaking a new one. Every
storage failure degrades rather than throws, and the interface says when
persistence is unavailable rather than pretending a save happened.

---

## 5. Rate limiting — PARTIAL

**What limits: compute — and it was tested by being tripped.** The analyzer
bounds what one analysis can cost, which is the resource-exhaustion question in
a client-only application: hostile input burns the visitor's own CPU, and an
unbounded run would hang their tab.

| Limit | Value | Where |
|-------|-------|-------|
| Files | 1000 | `core/internal/analyzer/analyzer.go:27` |
| Total source | 8 MiB | `analyzer.go:28` |
| Single file | 2 MiB | `analyzer.go:29` |
| Edges | 50 000 | `analyzer.go:30` |
| Instances per resource | 1000 | `expansion.go:21` |
| Instances total | 20 000 | `expansion.go:22` |
| Module depth | 10 | `modules.go:21` |
| Modules | 200 | `modules.go:22` |

The baseline asks whether any limit was ever provoked. These were:

```
$ go test ./internal/analyzer -run "TestLimitsAreEnforced|TestExpansionIsCapped|TestDeeplyNested|TestModuleCycle" -v
=== RUN   TestLimitsAreEnforcedAndReported
=== RUN   TestLimitsAreEnforcedAndReported/file_too_large
=== RUN   TestLimitsAreEnforcedAndReported/too_many_files
--- PASS: TestLimitsAreEnforcedAndReported (0.01s)
=== RUN   TestDeeplyNestedBlocksAreBounded
--- PASS: TestDeeplyNestedBlocksAreBounded (0.00s)
=== RUN   TestExpansionIsCappedAndSaysSo
--- PASS: TestExpansionIsCappedAndSaysSo (0.01s)
=== RUN   TestModuleCycleIsBrokenAndReported
--- PASS: TestModuleCycleIsBrokenAndReported (0.00s)
ok      github.com/Isma-L154/TerraVisual/core/internal/analyzer 0.398s
```

Each of these builds input that exceeds the limit and asserts the result says
so, rather than asserting that a constant holds a value.

**What does not limit: requests to the deployment.**

```
$ grep -rn "ratelimit\|rate_limit\|rate-limit" wrangler.jsonc deploy .github
(none)
```

No rate-limiting binding, no WAF rule in this repository, no limit in the
Worker. Nothing here constrains how often anyone can request the site.

**What an attacker gains, concretely:** not data. Every response is a public
static file containing no user content, so flooding it discloses nothing and
corrupts nothing. What it can do is consume Workers requests, which are billed,
and at sufficient volume make the site slow or unavailable for other people. The
realistic outcome is an invoice or a day of downtime, not a breach.

**Smallest change that fixes it:** a Cloudflare rate-limiting rule on the zone,
or the Workers `ratelimit` binding applied per client IP in `deploy/worker.ts`,
together with a spend alert so the failure mode is a notification rather than a
bill.

**UNVERIFIED:** Cloudflare applies platform-level DDoS protection by default,
which probably absorbs the crude version of this. Whether it is active on this
account, and at what threshold, cannot be read from this repository. It is
recorded as unverified rather than counted as mitigation.

---

## 6. Row level security — N/A (structural)

There is no database, no server-side storage and no accounts. Nothing in this
project holds data belonging to more than one person, so there are no rows to
isolate and no role that could bypass a policy.

One place data does cross between people, worth stating plainly because it is
easily mistaken for an access-control failure: **a share link contains the
workspace.** There is no server to hold it, so the code travels in the URL
fragment, and possession of the link is possession of the code. That is the
design, and the interface says so at the moment of sharing rather than in
documentation — the success message reads *"Link copied. It contains your
Terraform."* (`web/src/app/ShareButton.tsx:47`).

The fragment, rather than the query string, is what keeps the privacy promise:
fragments are never sent in an HTTP request, so a shared workspace reaches
neither Cloudflare nor anyone else in transit. That property is asserted by a
test rather than assumed (`share.test.ts:29-35`).

---

## 7. Content Security Policy — PARTIAL

**Read off a real response, not off the configuration.** With the Worker running
locally (`npx wrangler dev --port 8790`):

```
$ curl -sI http://localhost:8790/
content-security-policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self'; worker-src 'self' blob:; manifest-src 'self';
  base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none';
  upgrade-insecure-requests
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
referrer-policy: no-referrer
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
x-frame-options: DENY
```

`scripts/check-headers.mjs` makes this a check rather than a habit: it requests a
real URL, asserts each header, and asserts that headers which must be *absent*
are absent. Against the running Worker every check passed on both `/` and
`/analyzer.wasm`, including that the WASM module is served as
`application/wasm`.

`frame-ancestors`, `object-src` and `base-uri` are set. HSTS,
`X-Content-Type-Options` and `Referrer-Policy` are present.

**`script-src` carries neither `unsafe-inline` nor `unsafe-eval`.** The built
HTML contains no inline script — its only script tag is
`<script type="module" crossorigin src="/assets/index-BBdDf1r5.js">`, and
`grep -c "<style" web/dist/index.html` returns 0. WebAssembly compiles under
`'wasm-unsafe-eval'`, which permits exactly that and not string-to-code
evaluation.

**`connect-src 'self'` is the privacy promise expressed as policy, and it holds
in practice.** Loading the application and then typing fresh Terraform into the
editor produced no network request beyond the application's own files:

```
Same-origin requests, whole session:
  GET /                               GET /favicon.ico
  GET /assets/index-BBdDf1r5.js       GET /assets/analyzer.worker-CzC_3Qtn.js
  GET /assets/index-Cx3mlNmJ.css      GET /wasm_exec.js
                                      GET /analyzer.wasm
```

Editing the source — including typing a deliberately identifiable bucket name —
added zero requests. Analysis, layout and rendering generated no traffic at all.

### Finding: `style-src 'unsafe-inline'`

A real deviation, not a nuance. The policy permits any inline stylesheet on the
page.

**Why it is there:** CodeMirror injects its theme as a `<style>` element at
runtime. Read from the live DOM:

```
document.querySelectorAll('style') -> 5 elements
  [0] ".ͼ1.cm-focused {outline: 1px dotted #212121;} .ͼ1 {position: …"   <- CodeMirror
  [1..4] ad-blocking rules injected by a browser extension               <- not ours
```

React Flow additionally sets `style` attributes on nodes to position them, which
CSP treats separately from `<style>` elements.

**What an attacker gains, concretely: very little today.** Exploiting
`style-src 'unsafe-inline'` requires first being able to inject markup, and
there is no injection point — no `innerHTML`, no `dangerouslySetInnerHTML`, no
user content rendered as HTML, and every value in the diagram passes through
React's escaping. Its real cost is a missing layer that would otherwise contain
a future mistake, and CSS injection is not harmless: it can exfiltrate attribute
values through selectors and background-image requests, and can visually rewrite
the page.

**Smallest change that fixes it:** a per-response nonce. Every request already
passes through the Worker (`run_worker_first: true`), so it can generate a
nonce, rewrite the HTML to carry it, and emit `style-src 'self' 'nonce-…'`.
CodeMirror supports this directly — `EditorView.cspNonce` is a facet in
`@codemirror/view` (`node_modules/@codemirror/view/dist/index.d.ts:1426-1430`),
and `style-mod` applies the nonce to the stylesheets it mounts. React Flow's
inline `style` attributes are not covered by a nonce and would still need
`style-src-attr 'unsafe-inline'` — a far narrower allowance than the present
one, since a style attribute cannot declare selectors or `@import`.

### Finding: violations are invisible

There is no `report-to` or `report-uri`. If the policy began blocking something,
or a dependency started trying to phone home, nobody would learn of it until a
user reported a broken page.

This is less an oversight than a collision between two goals: a CSP report
endpoint is a server that receives data about what visitors' browsers are doing,
which is precisely the thing this product promised not to build. A fix has to
reckon with that trade-off rather than just adding a directive.

---

## What could not be verified

Much of an audit's value is in this list. Everything below is currently an
assumption.

1. **The production deployment.** Headers were verified against `wrangler dev`,
   which runs the same `deploy/worker.ts` but is not the production edge. No
   Cloudflare credentials exist in this environment, so nothing has been
   deployed. *Access needed:* the `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` repository secrets — after which the deploy workflow
   runs `check-headers.mjs --strict-tls` against the real URL on every
   deployment and this becomes verified continuously rather than once.
2. **Cloudflare account configuration.** WAF rules, DDoS thresholds, bot
   management, spend alerts, and the real scope of the API token. None of it
   lives in this repository. *Access needed:* the Cloudflare dashboard.
3. **HSTS preload status.** The header is served with `preload`, but submission
   to the preload list is a separate act that has not happened.
4. **Browser extensions defeat all of this — observed, not theorised.** The
   browser used for this audit runs a security extension that injected four
   stylesheets and several scripts into the page and made requests to
   `gc.kis.v2.scr.kaspersky-labs.com` carrying the page URL. Chrome exempts
   extension content scripts from a page's CSP by design. The privacy guarantee
   is therefore accurate as written — *the application* sends nothing — but it
   cannot bind software the user installed with permission to read every page.
   This belongs in the public documentation rather than in fine print.
5. **The analyzer's memory safety under WebAssembly.** Go's runtime and
   `hashicorp/hcl` are assumed sound. Fuzzing (643 000 executions, no crashes)
   is evidence of robustness against malformed input, not proof of memory
   safety.
6. **Dependency state is a snapshot, not a property.** As of this audit:
   `npm audit` reports 0 vulnerabilities in both workspaces, `govulncheck` is
   clean on `core` and `spike/wasm-core`, and open Dependabot alerts number 0.
   That is true today and says nothing about next week — which is why the
   security job in CI scans every Go module on every run.

---

## Findings ordered by real risk in this project

1. **No request-rate limit on the deployment** (control 5). The only finding
   with a plausible unhappy ending: an inflated bill, or a day of downtime. It
   ranks first because it can actually cost something here, not because rate
   limiting is severe in the abstract.
2. **`style-src 'unsafe-inline'`** (control 7). No exploit path exists today,
   because nothing can inject markup into the page. A missing layer of defence
   rather than a hole, and worth closing while the application is still small
   enough that closing it is cheap.
3. **No CSP violation reporting** (control 7). Costs visibility, not safety, and
   the obvious fix conflicts with the product's central promise. Needs a
   decision, not a patch.
4. **Unverified production surface** (blind spot 1). Resolves itself the moment
   credentials are added, because the check is already in the pipeline.
5. **Browser extensions can read the editor** (blind spot 4). Not fixable by
   this project. Belongs in the documentation, so the promise stays precise.

Items 1, 2, 3 and 5 become their own issues. Nothing was changed by this audit.
