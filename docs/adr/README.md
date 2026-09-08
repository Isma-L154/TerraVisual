# Architecture Decision Records

Decisions with long-term consequences, recorded with their context, the options
weighed, and what each one costs us.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-client-only-architecture.md) | Client-only architecture, no backend | Accepted |
| [0002](0002-go-wasm-analysis-core.md) | Go analysis core compiled to WebAssembly | Accepted |
| [0003](0003-containment-diagram-and-layout.md) | Containment diagram, React Flow, in-house layout | Accepted |
| [0004](0004-data-driven-resource-catalog.md) | Data-driven resource catalog | Accepted |
| [0005](0005-frontend-stack.md) | Frontend stack: React, TypeScript, Vite, CodeMirror 6 | Accepted |
| [0006](0006-hosting-cloudflare-workers.md) | Hosting on Cloudflare Workers | Accepted |

Each record states context, problem, options considered, decision, rationale,
consequences and rejected alternatives. Superseded records are kept and marked,
never deleted — the reasoning behind a decision we later reversed is usually the
most useful thing in the file.

The full picture these decisions serve is in
[../architecture/architecture-proposal.md](../architecture/architecture-proposal.md).
