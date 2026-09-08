# Spike: Go/WASM analysis core

Throwaway code for issue #1. It exists to answer one question with numbers:
can `hashicorp/hcl` plus `go-cty`, compiled to WebAssembly, evaluate Terraform
in a browser tab within our size and latency budgets?

**Do not build on this.** It has no catalog, no containment rules, no module
support and no resource references. The production analyzer starts fresh in
issue #7, informed by what was learned here.

The findings, with the numbers and the verdict, are in
[`docs/architecture/spike-wasm-core.md`](../../docs/architecture/spike-wasm-core.md).

## Running it

```bash
# Native: evaluate the hand-written fixture and print the model
go run . -dir testdata

# Tests, including the fuzz target
go test ./...
go test -fuzz FuzzAnalyze -fuzztime 30s

# Build the WASM artifact
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o dist/analyzer.wasm .

# Size and latency under Node
node harness/gen-fixture.mjs 50   fixtures/n50
node harness/gen-fixture.mjs 200  fixtures/n200
node harness/gen-fixture.mjs 1000 fixtures/n1000
node harness/bench.mjs

# The same artifact in a real browser Web Worker
node harness/serve.mjs   # then open http://localhost:8787/
```

Generated fixtures are not committed: `harness/gen-fixture.mjs` is deterministic,
so the numbers are reproducible from the script. The hand-written fixture in
`testdata/` is committed, because it encodes deliberate choices about which
language constructs the spike must exercise.

## Size probes

The size breakdown in the findings was produced with build tags that swap the
function table, so the cost of each dependency can be attributed rather than
guessed:

```bash
GOOS=js GOARCH=wasm go build -tags nofuncs  -ldflags="-s -w" -o dist/probe-nofuncs.wasm .
GOOS=js GOARCH=wasm go build -tags minfuncs -ldflags="-s -w" -o dist/probe-minfuncs.wasm .
```

Plus `harness/sizeprobe/hello`, an empty module that establishes the floor
imposed by the Go runtime itself.
