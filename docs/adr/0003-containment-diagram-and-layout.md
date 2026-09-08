# ADR-0003 — Containment diagram, React Flow, and a deterministic in-house layout

**Status:** Accepted
**Date:** 2026-09-07

## Context

The product exists to make the relationship between code and infrastructure
understandable. There are two distinct relationships in Terraform code:
*this lives inside that*, and *this needs that*. They call for different
pictures.

A crucial fact shapes everything here: **containment does not exist in
Terraform**. An `aws_instance` declares `subnet_id = aws_subnet.public.id`,
which to the parser is indistinguishable from `vpc_security_group_ids`. Nesting
is our interpretation, not a fact in the AST (see ADR-0004).

## Problem

What shape should the diagram take, and what should compute it?

## Options considered

**Diagram shape**
1. Nested architecture diagram — containment only.
2. Dependency DAG, like `terraform graph`.
3. Nested containment plus toggleable relationship layers.

**Edges within the chosen shape**
1. No edges at all.
2. A curated subset that teaches something.
3. Every dependency the code expresses.

**Layout engine**
1. `elkjs` — mature compound-graph layout.
2. An in-house deterministic nested box packer.

## Decision

A **nested containment diagram with a curated set of connections**, rendered with
**React Flow** (`@xyflow/react`, MIT), positioned by an **in-house deterministic
layout module** behind the interface `(InfraModel) → Positions`.

## Rationale

**Why containment, not a DAG.** A dependency graph shows the code's structure; a
nested diagram shows the infrastructure's shape. Beginners think in the second
one — it is what people draw on whiteboards.

**Why curated edges, not all of them.** Drawing every reference is easy to
justify and produces unreadable tangles once security groups, IAM roles and route
tables appear. Filtering to what matters is precisely why tools like InfraMap and
Rover exist. Which relationships deserve an edge is an editorial decision, and it
belongs in the catalog alongside the other editorial decisions.

**Why our own layout.** This is the choice most likely to be challenged, so the
reasoning is stated plainly:

- Our problem is not a general graph. It is a containment tree with a few local
  edges, which is recursive box packing.
- `elkjs` costs 8 MB unpacked and is licensed *EPL-2.0 OR GPL-3.0-or-later*,
  not MIT.
- Most importantly: a general engine recomputes positions globally, so **boxes
  move on their own while the user types**. That breaks the mental link between
  "what I just wrote" and "what changed on screen" — which is the product itself.

**Why React Flow.** Nodes are real DOM elements, so CSS, focus management and
screen readers work normally. It provides parent nodes, pan/zoom and keyboard
navigation, under MIT.

## Consequences

**Positive**
- Stable positions while typing.
- No 8 MB dependency and no copyleft license in the rendering path.
- Deterministic layout means regression tests compare positions as data instead
  of screenshots — cheaper and free of flaky pixel diffs.

**Negative**
- We own and maintain layout code.
- Edge routing between nested containers is limited; the curated edge set is
  chosen partly to stay within what a simple router handles well.
- If full dependency edges are ever added, this layout will likely need
  replacing.

**Mitigation.** The layout sits behind `(InfraModel) → Positions`. Swapping in
`elkjs` touches one module and no consumer.

## Rejected alternatives

- **Dependency DAG as the primary view** — shows the least intuitive relationship
  for a beginner and looks nothing like an architecture diagram.
- **All dependencies drawn** — unreadable on real projects, forces `elkjs`, and
  makes the layout jump on every keystroke.
- **`elkjs` from the start** — solves a graph problem the MVP does not have, at a
  real cost in weight, licensing and positional stability.
- **Hand-written SVG or canvas rendering** — we would rebuild pan, zoom, focus
  and accessibility that React Flow already provides.
