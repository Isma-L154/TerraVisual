# ADR-0005 — Frontend stack: React, TypeScript, Vite, CodeMirror 6

**Status:** Accepted
**Date:** 2026-09-07

## Context

ADR-0002 spends roughly 2 MB of the payload budget on the WASM analysis core.
ADR-0003 selects React Flow for rendering. Whatever else the client uses has to
fit in what remains while still meeting NFR-5 (the editor must be usable before
the WASM module arrives) and NFR-6 (WCAG 2.2 AA, keyboard-only journeys).

## Problem

Which framework, build tool and code editor?

## Options considered

**Editor:** Monaco vs CodeMirror 6.
**Framework:** React (required by React Flow) vs a framework-agnostic renderer
built by hand.
**Build:** Vite vs a meta-framework such as Next.js.

## Decision

- **React + TypeScript**, because React Flow requires it and the alternative is
  rebuilding pan, zoom, focus and accessibility ourselves.
- **Vite**, producing a plain static bundle.
- **CodeMirror 6** with `codemirror-lang-hcl` (MIT).
- **No global state library.** React local state plus the store React Flow
  already carries, until a real problem justifies more.

## Rationale

**CodeMirror over Monaco.** Monaco is 2–5 MB; CodeMirror 6 is modular and
tree-shakeable, with HCL support at roughly 300 KB. On a budget already committed
to WASM, that difference is the editor appearing immediately versus the user
staring at an empty pane. Monaco's accessibility is excellent, but CodeMirror 6's
is sound, and we are adding a separate accessible tree view for the diagram
regardless.

**Vite, not a meta-framework.** ADR-0001 removed the server. Server-side
rendering, routing and API routes would all be unused machinery, and the output
we need is a static directory.

**No state library yet.** Adding one now would be a premature abstraction. The
data flow is short — workspace → worker → model → layout → view — and mostly
unidirectional.

## Consequences

**Positive**
- Small payload beyond the unavoidable WASM cost.
- Fast local development and a trivially portable static build.
- Fewer dependencies to audit, which supports the supply-chain posture in the
  security model.

**Negative**
- CodeMirror gives syntax highlighting, not Terraform language intelligence;
  completions and hovers, if wanted later, must be built on our own analyzer
  output.
- React Flow ties rendering to React; changing framework later would mean
  changing renderer too.
- Hand-rolled state may need revisiting once undo/redo and multi-file selection
  arrive.

## Rejected alternatives

- **Monaco** — a VS Code-grade experience at 7–16× the size, on a payload budget
  already strained.
- **Next.js or similar** — server capabilities we deliberately do not have.
- **A global state library from day one** — no problem yet exists that justifies
  it.
