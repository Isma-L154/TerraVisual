# Spike findings — Go/WASM analysis core

**Issue:** #1
**Date:** 2026-09-07
**Question:** can a Go module using `hashicorp/hcl` and `zclconf/go-cty`, compiled
to WebAssembly, evaluate Terraform inside a browser tab within the size and
latency budgets set in the architecture proposal?

**Verdict: latency passes with a wide margin. Size fails the budget as written.**
ADR-0002 is sound; NFR-5 is not. The recommendation is to keep the architecture
and revise the budget, with the reasoning set out in §6.

---

## 1. What was built

A throwaway Go module at `spike/wasm-core/` that:

- parses a multi-file workspace with `hclparse` / `hclsyntax`;
- resolves input variables from their defaults;
- resolves `locals` to a fixpoint, so declaration order does not matter;
- evaluates resource bodies through `hcl.EvalContext`;
- expands `count`, exposing `count.index` inside the block;
- exposes 77 Terraform functions mapped onto `cty/function/stdlib` and
  `hashicorp/go-cty-funcs`;
- reports anything undeterminable as unknown **with a reason**, never guessed;
- runs both natively and as WASM inside a Web Worker.

It is not the production analyzer. It has no catalog, no containment rules, no
module support and no resource references.

## 2. How it was measured

| | |
|---|---|
| Machine | AMD Ryzen 5 7600X, 6 cores / 12 threads, 31 GB RAM |
| OS | Windows 11 Pro 10.0.26200 |
| Go | 1.27.0, standard toolchain, `GOOS=js GOARCH=wasm`, `-ldflags="-s -w"` |
| Browser | HeadlessChrome 151, analyzer running in a dedicated Web Worker |
| Node | 24.18.0 |
| Compression | Brotli quality 11, which is what Cloudflare serves |
| Runs | 30 per workspace, after a warm-up call, reported as p50 / p95 |

Reproduce with:

```bash
cd spike/wasm-core
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o dist/analyzer.wasm .
node harness/gen-fixture.mjs 50   fixtures/n50
node harness/gen-fixture.mjs 200  fixtures/n200
node harness/gen-fixture.mjs 1000 fixtures/n1000
node harness/bench.mjs            # size + latency under Node
node harness/serve.mjs            # then open http://localhost:8787/ for browser numbers
```

Fixtures are committed. The generated ones are not trivial: every resource
carries interpolation, a function call and a conditional, because benchmarking
literal-only attributes would measure the parser and flatter the evaluator.

## 3. Latency — passes

Measured in the browser, inside the Web Worker:

| Workspace | Resources | p50 | p95 | Budget | Margin |
|---|---|---|---|---|---|
| Hand-written fixture | 7 | 2.0 ms | 5.2 ms | — | — |
| Generated | 50 | 6.6 ms | 10.1 ms | — | — |
| Generated | 200 | 29.0 ms | **36.6 ms** | < 300 ms (NFR-4) | **8×** |
| Generated | 1000 | 157.8 ms | **180.7 ms** | < 1 s (NFR-4) | **5.5×** |

Cold instantiation: **62 ms**, once per page load.

Node numbers agree closely (41 ms instantiation; 41 ms and 210 ms p95 at 200 and
1000 resources), so the result is not an artifact of one runtime.

**Note on hardware.** These come from a fast desktop CPU. An attempt to emulate a
slower device with DevTools CPU throttling at 4× produced *identical* numbers,
which shows the throttle did not reach the worker thread — so it is reported as
a failed measurement, not as evidence. What can be said honestly is that the
margins are 8× and 5.5×, so a device several times slower still lands inside
budget. Real mid-range device validation belongs to issue #23.

## 4. Size — fails as written

| Variant | Raw | Gzip | Brotli |
|---|---|---|---|
| Default build | 9.49 MB | — | — |
| `-ldflags="-s -w"` | 9.33 MB | 2.55 MB | **1.85 MB** |
| After `wasm-opt -Oz` | 8.59 MB | 2.54 MB | 1.86 MB |

**Budget (NFR-5): ≤ 1.5 MB compressed. Actual: 1.85 MB. Over by 23 %.**

`wasm-opt -Oz` shaves 8 % off the raw binary and **nothing** off the compressed
transfer — the bytes it removes were already nearly free after compression. It is
not a lever here.

### Where the size goes

| Component | Raw | Brotli | Added |
|---|---|---|---|
| Go runtime alone (empty module) | 1.89 MB | 0.42 MB | — |
| `+ hcl + cty`, zero functions | 7.91 MB | 1.50 MB | **+1.08 MB** |
| `+ 30 functions from cty stdlib` | 7.92 MB | 1.50 MB | **+0.00 MB** |
| `+ full 77-function table with go-cty-funcs` | 9.33 MB | 1.85 MB | +0.34 MB |
| (of which `go-cty-funcs/crypto`) | | | 0.24 MB |

Three things follow, and they matter more than the headline number:

1. **`cty` stdlib functions are free.** Going from zero to thirty functions cost
   nothing measurable, because the machinery is already linked in by `cty`
   itself. Function coverage is therefore *not* the size problem, which is good
   news for issue #12 — a large function table is affordable.
2. **The irreducible floor is 1.50 MB brotli**: Go's runtime plus `hcl` and
   `cty`, with no functions at all. The 1.5 MB budget is therefore only
   reachable by shipping an analyzer that evaluates nothing, which defeats the
   purpose.
3. The only real lever is `go-cty-funcs/crypto` at 0.24 MB, which buys
   `sha256`, `md5`, `bcrypt` and friends. Dropping it lands at 1.61 MB — still
   over budget, and at the cost of functions Terraform users genuinely write.

## 5. Other findings

**A real bug, found and fixed.** The `locals` fixpoint loop used `len(pending)`
as its iteration bound, but `pending` shrinks as locals resolve, so the bound
tightened on every pass and abandoned the deepest dependency chains. The symptom
was insidious: `sha256(jsonencode(...))` came back as *unknown* when it was
perfectly determinable. In a tool whose selling point is honesty, a false
"unknown" is nearly as damaging as a false value. The production evaluator must
capture the bound before iterating, and must test a chain at least four levels
deep.

**Fuzzing works, and it is fast.** A 20-second run of `go test -fuzz` executed
**643,094 inputs across 12 workers with no crash**, growing the corpus to 229
interesting cases. This confirms the practical claim behind choosing Go in
ADR-0002: the analyzer can be fuzzed continuously in CI at negligible cost, on
the one component that processes untrusted input.

**Panic recovery is mandatory at the WASM boundary.** A Go panic crossing into JS
kills the module, after which every subsequent keystroke fails too. The spike
recovers and returns a diagnostic. NFR-7 should be read as covering the boundary,
not only the parser.

**Resource references are not implemented** (`aws_vpc.main.id` resolves to
unknown). That is deliberate — it needs the dependency graph that issue #7
builds — but it means the spike's output is not representative of final fidelity.

**MIME type matters.** `WebAssembly.instantiateStreaming` fails unless the server
sends `application/wasm`. Issue #4 must assert this against a real response.

## 6. Recommendation

**Keep ADR-0002.** The architecture works: real HCL, real `cty` semantics, real
evaluation, comfortably fast, in a worker, with nothing leaving the browser.

**Revise NFR-5**, because the budget was set before this evidence existed and is
not reachable by any configuration of this architecture. Proposed replacement:

> **NFR-5 (revised).** The analyzer artifact must not exceed **2.0 MB
> compressed**. It must be loaded lazily and cached immutably, and the editor
> must be interactive before it arrives. Time to an interactive editor, not
> artifact size, is the user-facing budget.

The reasoning for accepting 1.85 MB:

- It is **downloaded once per version** and served immutably from cache
  afterwards. It is not a per-visit cost.
- It is **off the critical path**: the editor is usable while it loads, and
  cold instantiation is only 62 ms once it lands.
- At 10 Mbps it is roughly 1.5 seconds, in the background, for a tool people
  then use for many minutes.
- The alternative that meets 1.5 MB is an analyzer with no functions — which
  would trade a real user-facing capability for a number nobody sees.

**If the project owner rejects the revision**, the honest options are to drop
the fidelity commitment (revisiting ADR-0002 toward a structural-only analyzer),
or to accept an analyzer with no function support. Neither is recommended.

**Follow-up work this spike creates:**

- Amend NFR-5 in the architecture proposal, and record the revision.
- Issue #7: capture the fixpoint bound before iterating; test a four-level chain.
- Issue #7: recover from panics at the WASM boundary.
- Issue #4: assert `application/wasm` against a real response.
- Issue #12: a large function table is cheap — coverage is limited by effort,
  not by bytes.
- Issue #23: measure on a genuinely mid-range device; DevTools CPU throttling
  does not reach worker threads.
