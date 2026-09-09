# Architecture Proposal — TerraVisual

**Status:** proposed, pending project owner approval
**Date:** 2026-09-07
**Scope:** initial architecture and technology stack for the MVP and its evolution

---

## 1. Product

TerraVisual is an educational tool for people learning Infrastructure as Code.
The user writes or imports Terraform and sees, in near real time, a diagram of
the infrastructure that code describes.

The goal is not to draw something pretty. It is to **make the relationship
between a line of code and a piece of infrastructure visible**. Everything else
is subordinate to that.

### 1.1 The learning loop

```
write code ─► analyze ─► infrastructure model ─► render ─► understand
     ▲                                                          │
     └──────────────────────────────────────────────────────────┘
```

The value lives in the speed and the fidelity of that loop. A diagram that lags,
or that lies, breaks the learning.

---

## 2. Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | The user can write Terraform in an in-browser editor |
| FR-2 | The user can import an existing project with multiple `.tf` files |
| FR-3 | The system analyzes the workspace and produces an infrastructure model |
| FR-4 | The system evaluates HCL expressions: variables, `locals`, functions, conditionals, interpolation |
| FR-5 | The system expands `count` and `for_each` when values are determinable |
| FR-6 | The system resolves local modules (`source = "./..."`), passing variables and reading outputs |
| FR-7 | The diagram represents **containment**: provider → region → network → subnet → resource |
| FR-8 | The diagram shows a **curated** set of connections between resources |
| FR-9 | Uncatalogued resources are still drawn, explicitly marked as uncatalogued |
| FR-10 | Resources are distinguished by provider through icon and text, never by color alone |
| FR-11 | Selecting a diagram node highlights its source code, and vice versa |
| FR-12 | Errors and ambiguities surface as diagnostics with exact source locations |
| FR-13 | A navigable textual representation equivalent to the diagram exists |
| FR-14 | Work persists locally between sessions |
| FR-15 | The user can share a link that reproduces their workspace |

### 2.1 Explicitly out of MVP scope

Stated deliberately, not forgotten:

- Remote modules (registry, git) — requires network access; see §11.
- Validation against provider schemas — requires downloading providers.
- Genuinely resolved `data` sources — requires cloud credentials.
- Visualizing `terraform plan` or `tfstate`.
- User accounts, collaboration, server-side persistence.
- A full dependency-edge layer (see §11 and the visualization ADR).
- Other IaC languages (Pulumi, CloudFormation, Bicep).

---

## 3. Non-functional requirements

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-1 | User code **never** leaves the browser | Zero network requests carrying user content; verifiable in the network panel |
| NFR-2 | Analysis never blocks typing | p95 keystroke handling < 50 ms, at any workspace size the analyzer accepts |
| NFR-3 | Loop latency | p95 keystroke → diagram < 500 ms up to 250 resources (includes 250 ms debounce); beyond that it grows with the number of nodes drawn |
| NFR-4 | Analysis performance | p95 < 300 ms at 200 resources; < 1 s at 1000 |
| NFR-5 | Payload weight | The editor is interactive **before** the analyzer arrives; the analyzer artifact ≤ **2.0 MB compressed**, lazily loaded and immutably cached. Time to an interactive editor, not artifact size, is the user-facing budget |
| NFR-6 | Accessibility | WCAG 2.2 AA; complete keyboard-only journey; no information conveyed visually only |
| NFR-7 | Analyzer robustness | No input causes an uncontrolled failure; always a diagnostic |
| NFR-8 | Operating cost | No application server; static hosting |
| NFR-9 | Honesty | Anything undeterminable is marked unknown; never invented |

NFR-9 is not decoration. In an educational tool, a fabricated value teaches
something false, which is worse than teaching nothing.

NFR-5 was revised after the spike in issue #1 measured the real artifact. The
original 1.5 MB was set before evidence existed and turned out to be unreachable
rather than merely missed: Go's runtime plus `hcl` and `cty`, with zero
functions, already costs 1.50 MB compressed. The measurements, the component
breakdown and the reasoning are in
[spike-wasm-core.md](spike-wasm-core.md).

**NFR-2 and NFR-3 were revised after the measurements in issue #23**, and the
change is narrower than it looks.

NFR-2 previously said "main thread never blocked > 50 ms by our own code". Its
purpose — analysis must never make the editor stutter — is met with a very large
margin: keystroke handling is p95 **12 ms** on a workspace of 1193 resources,
because analysis happens in a worker. But the old wording also covered something
it was never about: React committing the diagram. Drawing 1193 nodes is a single
render of 67–162 ms, once per debounced update, and no amount of worker
isolation changes that. The requirement now says what it actually protects and
is measured directly.

NFR-3 gained a size. At 239 resources the loop is p95 **356 ms** against a
500 ms budget; at 1193 it is **860 ms**, of which 250 ms is the debounce, about
190 ms is analysis, and the rest is rendering twelve hundred DOM nodes. Making
that fit would mean drawing fewer nodes — virtualisation, or a deliberate cap
with the outline staying complete — which is a feature rather than a tuning
exercise, and has its own issue. Stating the size at which the budget holds is
honest; quietly leaving the number at 500 ms and not measuring above 200
resources would not be.

The measurements are in
[the performance report](../testing/2026-09-08-performance.md).

---

## 4. Constraints

- **No application backend.** A direct consequence of NFR-1 and of the project
  owner's decision.
- **All analysis happens in the browser**, including HCL expression evaluation,
  which is the computationally serious part.
- **Hosted on Cloudflare Workers** with a custom domain.
- The repository is public, so every dependency must carry a license compatible
  with that.

---

## 5. Architecture

### 5.1 Overview

```
┌──────────────────────── Browser ──────────────────────────┐
│                                                            │
│  Main thread                        Web Worker             │
│  ┌──────────────────┐               ┌──────────────────┐   │
│  │ CodeMirror 6     │  files        │  WASM (Go)       │   │
│  │ (editor)         ├──────────────►│  hcl + cty       │   │
│  └──────────────────┘  debounced    │  + catalog       │   │
│           ▲                         └────────┬─────────┘   │
│           │ ranges                           │ InfraModel  │
│  ┌────────┴─────────┐               ┌────────▼─────────┐   │
│  │ React Flow       │◄──positions───┤ nested layout    │   │
│  │ (diagram)        │               └──────────────────┘   │
│  └──────────────────┘                        │             │
│  ┌──────────────────┐                        │             │
│  │ accessible tree  │◄───────────────────────┘             │
│  └──────────────────┘                                      │
│                                                            │
│  IndexedDB (local persistence)                             │
└────────────────────────────────────────────────────────────┘
                            │
                            │ static assets only, same origin
                            ▼
              Cloudflare Worker (assets + headers)
```

What matters about this diagram is what it does **not** contain: no API, no
database, no queue, no object storage, no authentication. Each of those was
considered and rejected for lack of a reason to exist (§9).

### 5.2 Components and their boundaries

| Component | Single responsibility | Input | Output |
|---|---|---|---|
| **Editor** | Edit text, show diagnostics | workspace | edits, cursor position |
| **Workspace** | In-memory virtual file system | edits, imports | set of files |
| **Analyzer (Go/WASM)** | Turn files into an `InfraModel` | files + catalog | `InfraModel` + diagnostics |
| **Layout** | Assign positions and sizes | `InfraModel` | positions |
| **Diagram** | Render and interact | model + positions | selection |
| **Accessible tree** | Expose the model without pixels | `InfraModel` | selection |
| **Catalog** | Per-provider domain knowledge | — | rules and presentation |
| **Persistence** | Save and restore the workspace | workspace | workspace |

Importing is local: the user drags files or a folder into the browser. Nothing is
uploaded anywhere, and paths are normalized and confined to the workspace root
(§10.1).

Each component can be understood and tested on its own. The analyzer is tested in
Go against fixture files, with no browser. The layout is tested with an input
model and expected positions, rendering nothing. The diagram is tested with a
fixed model and fixed positions, with no analyzer.

### 5.3 Why a Web Worker

This is not architectural ornament. Evaluating a large workspace can take
hundreds of milliseconds, and it happens while the user is typing. On the main
thread that feels like a broken editor. Isolating the WASM module in a worker
also confines it to a disposable thread: if a pathological input stalls it, the
worker is terminated and replaced without losing the session.

---

## 6. Domain model

The `InfraModel` is the intermediate representation between code and drawing, and
it is the system's contractual boundary: the analyzer is its only producer, and
everything else is a consumer.

```jsonc
{
  "schemaVersion": 1,
  "nodes": [{
    "id": "aws_instance.web[0]",
    "address": "aws_instance.web[0]",
    "type": "aws_instance",
    "provider": "aws",
    "category": "compute",
    "label": "web",
    "isContainer": false,
    "parentId": "aws_subnet.public",   // decided by the catalog, not by HCL
    "unplaced": false,                  // true when no parent could be determined
    "catalogued": true,                 // false → generic node
    "attributes": {
      "instance_type": { "known": true,  "value": "t3.micro" },
      "ami":           { "known": false, "reason": "depends on a data source" }
    },
    "source": { "file": "main.tf", "startLine": 12, "startCol": 1,
                "endLine": 18, "endCol": 2 },
    "expansion": { "kind": "count", "index": 0, "total": 2 }
  }],
  "edges": [{
    "id": "e1", "from": "aws_lb.front", "to": "aws_instance.web[0]",
    "kind": "traffic",
    "source": { "file": "lb.tf", "startLine": 22 }
  }],
  "diagnostics": [{
    "severity": "warning", "code": "unresolved-value",
    "message": "Value of 'ami' depends on a data source and cannot be determined",
    "source": { "file": "main.tf", "startLine": 14 }
  }],
  "stats": { "files": 4, "resources": 17, "durationMs": 61, "truncated": false }
}
```

Three decisions are baked into the shape of this model:

1. **`known: false` is a first-class value.** There is no ambiguous `null` or
   empty string standing in for "don't know". The UI can and must distinguish
   "empty" from "unknown". This is NFR-9 turned into a data structure.
2. **`source` is on everything.** Nodes, edges and diagnostics all know where
   they came from. Bidirectional navigation (FR-11) falls out of that almost for
   free.
3. **`parentId` is a catalog decision, not an HCL fact.** Explained in §7,
   because it is the point most likely to be misread in a review.

---

## 7. The catalog, and why it is the heart of the product

**Containment does not exist in Terraform.** An `aws_instance` does not declare
"I live inside this subnet"; it declares `subnet_id = aws_subnet.public.id`. To
the parser that is exactly the same kind of thing as
`vpc_security_group_ids`. The nesting this product draws **is not in the code:
we decide it**, resource type by resource type.

So the catalog is not an icon table. It is the domain knowledge that turns flat
references into a comprehensible hierarchy.

```jsonc
{
  "type": "aws_instance",
  "provider": "aws",
  "category": "compute",
  "displayName": "EC2 Instance",
  "icon": "aws/ec2",
  "isContainer": false,
  "parentRules": [
    { "attribute": "subnet_id", "priority": 1 },
    { "attribute": "vpc_id",    "priority": 2 }
  ],
  "edgeRules": [
    { "attribute": "vpc_security_group_ids", "kind": "security", "show": false }
  ],
  "labelTemplate": "{{name}}"
}
```

**One file, two consumers.** The Go analyzer embeds it to compute `parentId` and
edges; the interface reads icon, display name and category from it. A JSON schema
and a test prevent the two from drifting apart.

**Non-negotiable rule:** a resource type absent from the catalog is still drawn,
as a generic node in an "unplaced" area, visibly marked. A real project will
bring dozens of uncatalogued types, and it must **never** look empty — or worse,
look complete when it is not.

**MVP coverage:** AWS, Azure and GCP at comparable medium depth — roughly 12–15
resources each, covering networking, compute, storage, databases, load balancing
and serverless. Adding a provider means adding data, never touching the
interface.

---

## 8. Technology stack

| Piece | Choice | License | Justification for this project |
|---|---|---|---|
| Parser and evaluator | `hashicorp/hcl` v2 | MPL-2.0 | Terraform's own parser, with `EvalContext` for expression evaluation. Reimplementing it would be 80 % of the project and would diverge forever |
| Type system | `zclconf/go-cty` | MIT | The type system Terraform uses, with unknown- and null-value semantics already solved |
| Functions | `go-cty/function/stdlib` + `hashicorp/go-cty-funcs` | MIT / MPL-2.0 | ~87 public functions (strings, numbers, collections, regex, JSON, dates) plus cidr, crypto, encoding and uuid |
| Compilation | Standard Go → `GOOS=js GOARCH=wasm` | — | TinyGo is ruled out: `go-cty` depends heavily on `reflect` |
| Isolation | Web Worker | — | NFR-2, plus containment of the WASM module |
| Editor | CodeMirror 6 + `codemirror-lang-hcl` | MIT | Modular and light (~300 KB) against Monaco's 2–5 MB; we already spend ~2 MB on WASM |
| Framework | React + TypeScript + Vite | MIT | Required by the chosen renderer; static build output |
| Rendering | `@xyflow/react` (React Flow) | MIT | Real DOM nodes, so CSS, focus and screen readers genuinely work; includes parent nodes, pan/zoom and keyboard support |
| Layout | Own deterministic module | — | See §8.1 |
| Hosting | Cloudflare Workers (static assets) | — | Lets us set security headers from code, unlike flat static hosting |

### 8.1 Why the layout is ours

This sounds like reinventing the wheel. It is not, because **our problem is not a
general graph**: it is a containment tree with a few local edges, solved by
packing boxes recursively.

- `elkjs`, the mature option for compound graphs, is 8 MB unpacked and ships
  under *EPL-2.0 OR GPL-3.0-or-later*, not MIT.
- A general engine recomputes positions globally: **boxes move on their own while
  the user types.** That breaks the mental link between "what I just wrote" and
  "what changed in the picture", which is literally the product.
- Deterministic packing is stable, predictable, and testable by comparing
  positions as data instead of fragile screenshots.

The layout lives behind the interface `(InfraModel) → Positions`. If this
decision proves wrong, or if full dependency edges ever arrive, swapping in
`elkjs` touches exactly one module.

---

## 9. Infrastructure considered and rejected

The brief requires every infrastructure component to have a documented reason to
exist. These have none:

| Component | Why it is rejected |
|---|---|
| Application backend | All analysis fits in the client. Adding one would violate NFR-1 and create usage-proportional cost |
| Database | There is no data belonging to more than one user. `IndexedDB` covers local persistence |
| Authentication | Nothing to protect: there are no per-user resources |
| API | There is no consumer other than our own client |
| Object storage | Workspaces are small text; they fit in the browser and in a link |
| Background jobs | Nothing asynchronous outlives the tab |
| Observability platform | With no server there are no server logs. See §14 |

---

## 10. Security

Baseline: the seven controls from the project's security audit document. They map
as follows, **with the structural reason for each N/A**, exactly as that document
demands.

| # | Control | Expected status | Reason / measure |
|---|---|---|---|
| 1 | Secrets in environment variables | **Applicable** | A client bundle is public by definition. Zero secrets in the repository; scanning in CI and across history |
| 2 | CORS | **Structurally N/A** | There is no API of our own. The Worker serves same-origin static assets and emits no `Access-Control-Allow-Origin` |
| 3 | Backend validation | **N/A as a server; reframed** | There is no server, but there is a trust boundary: the WASM module receives hostile input. Limits on total size, file count, recursion depth, maximum `count`/`for_each` expansion, and an evaluation timeout |
| 4 | Input sanitization | **Highly applicable** | (a) resource names reaching the DOM → XSS; (b) module `source` values → traversal in the virtual file system; (c) shared links → deserialization of untrusted data, schema-validated before use |
| 5 | Rate limiting | **N/A at the service** | Static assets behind Cloudflare. The real analogue is the worker's compute budget, covered by control 3 |
| 6 | Row level security | **Structurally N/A** | No database and no multi-tenancy: there are no rows belonging to anyone to isolate |
| 7 | CSP | **Highly applicable** | `script-src 'self' 'wasm-unsafe-eval'` with no `unsafe-inline` and no `unsafe-eval`; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`; plus HSTS, `X-Content-Type-Options` and `Referrer-Policy`. Set from the Worker itself |

`'wasm-unsafe-eval'` is supported across all major browsers and allows compiling
WebAssembly **without** enabling `unsafe-eval`.

Above the baseline, and because it was explicitly requested: `govulncheck` for
Go, dependency and secret scanning, static analysis in CI, and an SBOM.

The audit runs before the first production deployment, and again on any change to
the exposed surface.

### 10.1 Threat model summary

| Threat | Vector | Mitigation |
|---|---|---|
| Stored XSS | A resource name or label containing HTML, reaching the DOM | React escapes by default; `dangerouslySetInnerHTML` is banned; CSP as a second barrier |
| Malicious shared link | Tampered `#` fragment | Schema validation and size limits before deserializing |
| Workspace traversal | `source = "../../.."` in a module block | Resolution confined to the virtual workspace root; paths normalized and checked |
| Resource exhaustion | `count = 100000`, module recursion, pathological expression | Hard limits and a timeout; the worker can be terminated and recreated |
| Supply chain | A compromised dependency | Pinned versions, automated scanning, a deliberately small dependency surface |

---

## 11. Deferred decisions and replaceable pieces

**Deferred** (not needed now, and would make the MVP more expensive):

- Distribution optimizations (caching, multi-region, extra domains). Hosting
  itself *is* decided — Cloudflare Workers — but the artifact is static and
  portable, so reversing it would cost little.
- Remote modules. An important privacy note: fetching a module from the registry
  would send **the module address**, never the user's code; even so it breaks the
  "zero network" promise and deserves its own ADR.
- Validation against provider schemas.
- Internationalization.

**Deliberately replaceable** (encapsulated behind an interface):

| Piece | Interface | Documented substitute |
|---|---|---|
| Layout | `(InfraModel) → Positions` | `elkjs` |
| Rendering | consumes model + positions | Hand-written SVG or canvas |
| Editor | consumes workspace, emits edits | Monaco |
| Persistence | `save/load(workspace)` | Any store |

**Essential now and hard to change later** — and therefore chosen carefully: the
`InfraModel` as a contract, the data-driven catalog, and the Go analysis core.

---

## 12. Testing strategy

| Level | What it covers | Tooling |
|---|---|---|
| Go unit | Expression evaluation, `count`/`for_each`, local modules | Table tests |
| Golden files | Fixture `.tf` → expected `InfraModel` | Go `testdata` |
| **Fuzzing** | The analyzer **never** fails uncontrolled | Native `go test -fuzz` |
| Catalog | Valid schema, no duplicates, icons exist, coherent rules | Data tests |
| TS unit | Deterministic layout, model → view mapping | Vitest |
| Integration | Worker + WASM + model, without UI | Vitest |
| E2E | Type and see; import a project; node ↔ code; shared link | Playwright |
| Accessibility | Keyboard-only journey; no automated violations | Playwright + axe |
| Performance | NFR-3 and NFR-4 budgets against reference workspaces | Measured in CI |

Fuzzing is not a luxury: the brief requires treating input as hostile, and the
analyzer is the only component that processes untrusted data. That Go ships it
out of the box was a real argument in its favor.

**There will be no pixel-based visual regression testing.** Because the layout is
deterministic, positions are compared as data: cheaper, and free of false
positives.

---

## 13. Repository structure

```
/
├─ .github/workflows/      CI: Go, TypeScript, E2E, security, deployment
├─ core/                   Go module compiled to WASM
│  ├─ cmd/wasm/            Entry point and the JS↔WASM boundary
│  ├─ internal/analyzer/   Files → InfraModel
│  ├─ internal/evaluator/  Evaluation graph: variables, locals, modules
│  ├─ internal/catalog/    Loading and applying catalog rules
│  └─ testdata/            Fixtures and expected models
├─ catalog/                Catalog data + JSON schema (single source of truth)
├─ web/                    React + Vite application
│  ├─ src/workspace/       Virtual file system
│  ├─ src/editor/          CodeMirror and diagnostics
│  ├─ src/worker/          Web Worker client
│  ├─ src/layout/          Deterministic nested box layout
│  ├─ src/diagram/         React Flow and per-category nodes
│  ├─ src/outline/         Accessible tree
│  └─ e2e/                 Playwright
├─ deploy/                 Cloudflare Worker: assets and headers
└─ docs/                   architecture · adr · security · testing · deployment
```

---

## 14. Observability

With no server there are no server logs, and adding an observability platform
just because it is customary would contradict the brief.

- **Zero telemetry by default.** This is consistent with NFR-1: it would be
  incoherent to promise that code never leaves the browser while shipping usage
  events out of it.
- **Diagnostics in the interface itself**, which is where the user needs them.
- **Cloudflare request metrics**, which exist anyway and never see user content.
- Anonymous error reporting remains a future possibility, always under
  **explicit consent** and documented in its own ADR.

---

## 15. CI/CD and deployment

```
push to branch ─► CI: build Go+WASM · tests · short fuzz · lint · types · E2E · security
                  └─► preview deployment
pull request ──► same checks, review required
merge to main ─► production deployment (Cloudflare Workers)
```

The artifact is a static directory plus a Worker that serves it and sets the
security headers. The WASM module is built in CI; no binary is committed to the
repository.

---

## 16. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | The WASM module is heavier or slower than acceptable | High | **Resolved by the spike in issue #1.** Latency passed with 8× and 5.5× margin; size came in at 1.85 MB compressed, which drove the revision of NFR-5 rather than a change of architecture |
| R2 | Behavioral differences from real Terraform | High | Terraform's functions live under `internal/` and are not importable, so the table is assembled from public packages. Coverage is documented, and anything unsupported is marked unknown — never approximated |
| R3 | A three-provider catalog is a lot of editorial work | Medium | Pure data validated by schema, splittable into independent tasks; the generic fallback means missing coverage breaks nothing |
| R4 | A bilingual Go + TypeScript repository | Medium | CI with both toolchains; single documented build commands |
| R5 | The hand-written layout falls short | Medium | Isolated behind an interface; `elkjs` documented as the substitute |
| R6 | Combinatorial explosion in `count`/`for_each` | Medium | Hard expansion limits and a timeout, which double as security control 3 |

R1 and R2 are the ones that can invalidate the architecture. That is why the
roadmap starts by proving them, not by building interface.

---

## 17. Initial roadmap

**Phase 0 — Prove what could sink the architecture** *(before any UI)*
1. Spike: a Go module with `hcl` + `cty` compiled to WASM, evaluating a `.tf`
   file with variables, `locals`, functions and `count`. **Measure compressed
   size and latency against NFR-4 and NFR-5.** If the numbers fail, the
   architecture is revised — not the budget.
2. Define and freeze the `InfraModel` schema and the catalog schema.

**Phase 1 — The minimal end-to-end loop**
3. Repository scaffolding, CI, quality gates and preview deployments.
4. In-memory workspace + editor with HCL highlighting.
5. Analyzer: resources, variables, `locals`, explicit references.
6. Initial AWS catalog + containment rules.
7. Deterministic nested box layout.
8. React Flow diagram + equivalent accessible tree.

**Phase 2 — The promised fidelity**
9. Full expression engine and functions.
10. `count` and `for_each` with limits.
11. Local modules.
12. Located diagnostics and visible unknown values.

**Phase 3 — The product**
13. Bidirectional code ↔ diagram navigation.
14. Importing an existing project.
15. Azure and GCP catalogs.
16. Curated connections.
17. Local persistence and shared links.

**Phase 4 — Ship**
18. Full security audit against the seven controls.
19. Accessibility audit.
20. Performance budget validation and production deployment.

---

## 18. Rejected alternatives

| Alternative | Why it is rejected |
|---|---|
| Hand-written parser and evaluator in TypeScript | Reimplementing HCL and `cty` semantics, unknown and null values included. Permanent divergence from Terraform and a high risk of "almost correct", which in an educational tool teaches the wrong thing |
| `@cdktf/hcl2json` + evaluation in TS | It returns expressions as text: you pay 1.8 MB of WASM **and** still reimplement the evaluator. It combines both options' costs without their benefits |
| Compiling with TinyGo | `go-cty` depends heavily on `reflect`, outside TinyGo's reliable support |
| Server-side parsing | Every keystroke would send private code over the network and cost would scale with usage. Contradicts NFR-1 |
| Running a real `terraform plan` | Requires the user's cloud credentials and an execution sandbox: the largest attack surface imaginable for a public product |
| `elkjs` from the start | 8 MB and an EPL/GPL license to solve a graph problem the MVP does not have, plus unstable positions while typing |
| Monaco as the editor | 2–5 MB against ~300 KB, on a budget already committed to WASM |
| Drawing every dependency | Produces unreadable tangles on real projects — the very problem InfraMap and Rover exist to avoid |
| Backend, database or authentication | None has a documented reason to exist in this product |

---

## 19. Sources consulted

- `hashicorp/hcl` — HCL parser and evaluator, MPL-2.0
- `zclconf/go-cty` and `cty/function/stdlib` — type system and ~87 functions, MIT
- `hashicorp/go-cty-funcs` — cidr, collection, crypto, encoding, filesystem, uuid, MPL-2.0
- `opentofu/opentofu` — confirms language functions live under `internal/lang/funcs`
- `@cdktf/hcl2json` (from `hashicorp/terraform-cdk`) — precedent for HCL→WASM, 1.84 MB
- TinyGo documentation on `reflect` limitations
- MDN — `script-src` and `'wasm-unsafe-eval'`
- `kieler/elkjs` and `xyflow/xyflow` — licenses, layout and rendering capabilities
- InfraMap and Rover — precedents in Terraform visualization

---

## 20. What is being submitted for approval

1. The client-only architecture, with no backend.
2. The Go analysis core compiled to WebAssembly.
3. The `InfraModel` as the contract between analysis and presentation.
4. The data-driven catalog as the source of containment.
5. The containment diagram with curated connections.
6. The stack in §8.
7. The MVP scope and its explicit exclusions.
8. Starting with the Phase 0 spike before writing any interface.
