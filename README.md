# TerraVisual

**See the infrastructure your Terraform describes, as you write it.**

TerraVisual is an educational tool for people learning Infrastructure as Code.
You write or drop in Terraform, and it draws the infrastructure that code
describes — updating as the code changes, so the link between a line of HCL and a
piece of infrastructure stays visible.

**It is live at [terravisual.cloudils.com](https://terravisual.cloudils.com).**

> **Status: the first version is deployed.** It parses and evaluates HCL —
> variables, locals, functions, expressions, `count`, `for_each` and local
> modules — and draws AWS, Azure and GCP resources from a catalog that is data
> rather than code. Start with the
> [architecture proposal](docs/architecture/architecture-proposal.md) for how it
> works and why, or the [audits](docs/security/) for what has been checked and
> what has not.

---

## Your code never leaves your browser

This is the product's central constraint, not a feature bullet.

Parsing, expression evaluation and rendering all happen client-side. There is no
backend, no database and no account. Nothing you type or import is uploaded
anywhere — you can confirm it yourself in your browser's network panel.

That matters because the tool is meant to be useful on *real* Terraform, which
tends to contain bucket names, internal CIDR ranges and account identifiers.

## How it works

```
CodeMirror ──► in-memory workspace ──► Web Worker ──► WASM (Go: hcl + cty)
                                                            │
                                              InfraModel ◄──┘
                                                    │
                                   ┌────────────────┴────────────────┐
                                   ▼                                 ▼
                         nested box layout                  accessible tree
                                   ▼
                            React Flow diagram
```

The analysis core is a Go module compiled to WebAssembly that reuses
[`hashicorp/hcl`](https://github.com/hashicorp/hcl) and
[`zclconf/go-cty`](https://github.com/zclconf/go-cty) — Terraform's own parser and
type system — rather than reimplementing the language. It produces an
`InfraModel`, the single contract everything else consumes.

Two properties of that model are worth calling out:

- **Unknown is a real value.** When something genuinely cannot be determined
  without cloud credentials or a network fetch, it is reported as unknown, not
  guessed. A teaching tool that invents values teaches falsehoods.
- **Everything knows where it came from.** Nodes, edges and diagnostics all carry
  exact source ranges, which is what makes clicking a box highlight its code.

## What it draws

A nested architecture diagram — provider, region, network, subnet, resource —
because that is how people actually picture infrastructure, plus a curated set of
connections that teach something rather than every reference the code contains.

Resource types the catalog does not yet know are still drawn, clearly marked as
uncatalogued. A real project must never look empty, and must never look complete
when it is not.

The diagram is not the only way to read the model: an equivalent keyboard-navigable
tree exposes the same structure, and providers are distinguished by icon and text
rather than by color alone.

## Scope

**In the MVP:** writing and importing multi-file Terraform, expression evaluation
(variables, `locals`, functions, conditionals), `count`/`for_each` expansion,
local modules, bidirectional code ↔ diagram navigation, and a curated catalog
covering AWS, Azure and GCP at comparable depth.

**Deliberately not in the MVP:** remote modules, provider-schema validation,
resolved `data` sources, `terraform plan` visualization, accounts and
collaboration. The reasoning for each exclusion is in the architecture proposal.

## Documentation

| | |
|---|---|
| [Architecture proposal](docs/architecture/architecture-proposal.md) | Requirements, design, security model, testing strategy, risks, roadmap |
| [Decision records](docs/adr/) | Why the significant choices were made, and what they cost |
| [Security](docs/security/) | The baseline audits, what they found, and what they could not verify |
| [Testing](docs/testing/) | The testing layers, and the accessibility audit |

## License

[Apache License 2.0](LICENSE).

TerraVisual builds on `hashicorp/hcl` and `hashicorp/go-cty-funcs` (MPL-2.0) and
`zclconf/go-cty` (MIT). Their file-level terms are compatible with this license
and apply to those files.
