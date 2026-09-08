# ADR-0002 — Go analysis core compiled to WebAssembly

**Status:** Accepted
**Date:** 2026-09-07

## Context

The product promises near-complete HCL fidelity: variables, `locals`, functions,
conditionals, interpolation, `count`/`for_each` expansion and local modules.
ADR-0001 requires all of that to run inside a browser tab.

Terraform's own semantics are subtle. The `cty` type system distinguishes known,
unknown and null values, and getting that wrong produces plausible-looking but
false output — the worst possible failure mode for a teaching tool.

## Problem

How do we turn Terraform source into an evaluated infrastructure model, in the
browser, without gradually diverging from real Terraform?

## Options considered

1. **Own Go module compiled to WASM**, importing upstream HashiCorp libraries.
2. **Hand-written parser and evaluator in TypeScript** (optionally with
   tree-sitter for syntax).
3. **`@cdktf/hcl2json` for structure + expression evaluation in TypeScript.**
4. **Structural analysis only**, deferring evaluation.

## Research findings

Verified before deciding:

- `hashicorp/hcl` v2 is public, standalone and MPL-2.0. It provides both parsing
  and expression evaluation via `EvalContext`.
- Terraform's own function library is **not importable**: it lives under
  `internal/lang/funcs`, in both Terraform and OpenTofu. Go enforces this.
- Its foundations *are* public: `zclconf/go-cty` (MIT) ships `cty/function/stdlib`
  with ~87 functions, and `hashicorp/go-cty-funcs` (MPL-2.0) adds cidr,
  collection, crypto, encoding, filesystem and uuid.
- Go + HCL → WASM is proven: `@cdktf/hcl2json`, from HashiCorp's own
  `terraform-cdk` repository, ships exactly that at 1.84 MB unpacked.
- That package does **not** solve our problem: it emits expressions as source
  text, and its `-simplify` mode only folds expressions with no variables or
  unknown functions.
- TinyGo is not viable: it is unsuitable for `reflect`-heavy code, and `go-cty`
  is exactly that. Standard Go, and a larger binary, is the only path.

## Decision

Option 1. A Go module importing `hashicorp/hcl`, `zclconf/go-cty` and
`hashicorp/go-cty-funcs`, compiled with standard Go to `GOOS=js GOARCH=wasm`,
running inside a Web Worker and exposing `analyze(files, catalog) → InfraModel`.

## Rationale

- **The hard parts are reused, not reimplemented.** Parsing and the type system —
  where the subtlety lives — are Terraform's own code.
- **What remains is bounded and testable**: the evaluation graph (ordering
  variables, locals, modules, resources), `count`/`for_each` expansion, and a
  name table mapping Terraform function names onto public implementations.
- **Diagnostics carry real source positions**, which is what makes bidirectional
  code ↔ diagram navigation possible.
- **Go ships native fuzzing.** The brief demands treating parser input as
  hostile; `go test -fuzz` gives us that for free, and this was a genuine factor
  in the choice.

## Consequences

**Positive**
- High fidelity without maintaining a language implementation.
- The analyzer is testable in Go with fixtures, with no browser involved.
- A Web Worker keeps the main thread free and confines the module to a
  disposable thread that can be killed and recreated.

**Negative**
- **~2 MB of WASM.** It must be lazily loaded, and the editor must be usable
  before it arrives.
- **A bilingual repository.** Two toolchains in CI and a heavier developer setup.
- **Function coverage will be incomplete**, because Terraform's own wrappers are
  unreachable. Uncovered functions must be reported as unknown, never
  approximated.
- Neither the size nor the latency is proven yet, which is why the roadmap opens
  with a spike that measures both against NFR-4 and NFR-5. If those numbers fail,
  this ADR is revisited.

## Rejected alternatives

- **TypeScript implementation** — reimplementing HCL and `cty`, including unknown
  and null semantics, means permanent divergence and a high risk of being
  "almost correct", which teaches the wrong thing.
- **`@cdktf/hcl2json` + TS evaluation** — pays the WASM cost *and* still requires
  writing the evaluator. Both costs, neither benefit.
- **TinyGo** — cannot reliably compile `reflect`-heavy dependencies.
- **Structural only** — contradicts the agreed fidelity, and the evaluation
  engine shapes the entire domain model, so it cannot be bolted on later.
