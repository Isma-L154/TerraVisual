# Development

## Requirements

| | |
|---|---|
| **Go 1.27+** | The analysis core. See [ADR-0002](adr/0002-go-wasm-analysis-core.md) for why the repository is bilingual |
| **Node 22+** | The browser application and the build scripts |

That is the whole list. There is no database, no server and no container to
run, because the application has none — see
[ADR-0001](adr/0001-client-only-architecture.md).

## Getting started

```bash
npm install          # installs the web workspace; Go modules resolve on first build
npm run build:core   # compiles the analyzer to WebAssembly into web/public/
npm run dev          # starts the app on http://localhost:5173
```

`build:core` also copies `wasm_exec.js` out of your Go installation rather than
vendoring a copy, so the shim always matches the compiler that produced the
binary.

## Commands

Every command runs from the repository root. The Go ones are wrapped in small
Node scripts so the same invocation works on Windows, macOS and Linux — that
wrapping is how the cost of a two-language repository is kept off daily work.

| Command | What it does |
|---|---|
| `npm run verify` | Generated-code drift, gofmt, `go vet`, Go tests, typecheck, lint, formatting, web tests and the build. Use this before opening a pull request |
| `npm run dev` | Development server for the browser application |
| `npm run build` | Builds the analyzer and the application |
| `npm run build:core` | Compiles the analyzer to WebAssembly **and fails if it exceeds the size budget** |
| `npm run test` | Go tests and web tests |
| `npm run test:core` / `test:web` | One side only |
| `npm run test:e2e` | Every browser test: builds first, then serves the build through the deployment Worker so the tests run under the production CSP |
| `npm run test:e2e:browser` / `test:e2e:performance` | The functional specs in parallel / the timed budgets alone (`--workers=1`), against an existing build. CI runs these two scripts, so a new spec in `web/e2e` runs everywhere without being listed |
| `npm run fuzz` | 30 seconds of fuzzing against the analyzer |
| `npm run perf:fixtures` | Regenerates the reference workspaces the performance budgets are measured against. Changing them changes the baseline |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` / `lint:core` | ESLint / gofmt check and `go vet` |
| `npm run format` | Prettier, writing changes |
| `npm run generate` | Regenerates the TypeScript types from `schemas/` and the Go copy of the catalog (`core/internal/catalog/data.gen.go`) from `catalog/`. CI and `npm run verify` fail on any drift |

## How the pieces fit

```
schemas/  JSON Schema: the single source of truth for the InfraModel and the catalog
core/     Go, compiled to WebAssembly. The only producer of the InfraModel
web/      React + Vite. Consumes the model; never parses Terraform itself
catalog/  Per-provider data: containment rules, icons, categories
scripts/  Node scripts: Go toolchain wrappers, code generation, the header check, brand assets
fixtures/ Terraform workspaces for the browser suite and the performance budgets
deploy/   The Cloudflare Worker that serves the static build with its headers
```

The analyzer runs in a Web Worker. That is not decoration: analysis happens
while the user is typing, so it must never touch the main thread, and confining
it to a disposable thread means a pathological input can be dealt with by
terminating the worker rather than the page.

## Working on this project

Every meaningful change starts from an issue and lands through a pull request.
The pull request template asks for the things that are hard to reconstruct
later: what you rejected, what is untested, which security controls you touched.

Some conventions worth stating, because they are easy to break by accident:

- **Never fabricate a value.** If something cannot be determined, it is reported
  as unknown with a reason. A confident wrong answer in a teaching tool teaches
  the wrong thing, and a false "unknown" is nearly as bad — see the bug found in
  [the spike](architecture/spike-wasm-core.md).
- **`dangerouslySetInnerHTML` is banned** and ESLint enforces it. Resource names
  come from user input and reach the DOM.
- **Do not commit build artifacts.** The WebAssembly binary is produced by the
  build, locally and in CI.
- **Do not hand-edit anything under `generated/`.** Change the schema and run
  `npm run generate`. The schema is the source of truth for both languages: Go
  validates itself against it in a test, TypeScript is generated from it, and
  the examples in `schemas/examples/` are checked by both sides.
- **Size budgets are enforced by the build**, not by good intentions. If a
  change pushes the analyzer over, either bring it back under or revise the
  budget deliberately and write down why.

## Dependency overrides

Each override in `package.json` is explained here, because JSON has nowhere to
explain itself. Overrides are a way of taking responsibility for somebody else's
dependency tree; each one should be temporary and should say when it can go.

- **`sharp` 0.35.5.** It arrives through `wrangler` → `miniflare`, and 0.35.4
  carries a high-severity librsvg advisory (GHSA-wq5f-xc86-pv6w). The `wrangler`
  release that brings 0.35.5 was a day old, inside Dependabot's one-week
  cooldown, so the fix is taken here instead (#148). Remove the override once
  `miniflare` requests 0.35.5 or later itself.

An earlier override pinned `sharp` to 0.35.4 for a libheif advisory
(GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545) and was removed once `miniflare`
requested that version (#142).

## Continuous integration

Five jobs run on every pull request: the Go core (format, vet, race tests, a
short fuzz run, and the size-budgeted WebAssembly build), the browser
application (generated-code drift, typecheck, lint, format, tests, build), the
browser suite against the real build (every spec in `web/e2e`, then the
performance budgets on their own), security checks (`govulncheck` and
`npm audit`), and dependency review. A separate Security workflow runs gitleaks,
semgrep, osv-scanner and zizmor on every pull request and on `main`; see
[docs/security/](security/README.md) for what each covers and where
suppressions are explained.

Every action is pinned to a commit SHA with its version in a comment, and
checkouts set `persist-credentials: false`; Dependabot keeps the pins current
and waits a week before proposing any release.

`npm run verify` covers the first two jobs apart from the race detector and the
fuzz run (`npm run fuzz` runs the latter). The browser suite needs a build and
a browser and so has its own command, `npm run test:e2e`. Between the two, a
red pipeline should rarely be a surprise.
