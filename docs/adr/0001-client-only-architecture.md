# ADR-0001 — Client-only architecture, no backend

**Status:** Accepted
**Date:** 2026-09-07

## Context

TerraVisual analyzes Terraform code and draws the infrastructure it describes.
Two product decisions shape this ADR:

1. It is a public product, open to anyone on the internet.
2. Users can import existing projects, not just toy examples.

Together those mean people will paste their employer's Terraform into it —
bucket names, internal CIDR blocks, account identifiers, and occasionally worse.

## Problem

Where does the user's code go, and what infrastructure does the product need in
order to run?

## Options considered

1. **Everything in the browser.** Parsing, evaluation and rendering all client-side.
2. **Minimal backend for sharing.** Client-side analysis, plus a service storing
   snapshots behind short permanent links.
3. **Full backend with accounts.** Authentication, server-side projects, history.
4. **Server-side parsing.** The browser posts code, the server returns a model.

## Decision

Option 1. The user's code never leaves the browser. There is no application
backend, no database, no authentication and no API.

## Rationale

- **Privacy becomes a verifiable claim, not a promise.** Anyone can open the
  network panel and confirm nothing is sent. Options 2–4 all require trusting us.
- **Attack surface collapses.** With no server storing third-party code, there is
  no retention policy, no deletion obligation, no abuse pipeline, and no illegal
  content problem.
- **Cost is flat and near zero**, rather than proportional to usage. That matters
  for a free educational product with no revenue model.
- **The work fits.** The analysis is CPU-bound and small; there is no reason it
  needs a server other than habit.
- Option 4 was the worst fit: it would put private code on the wire on every
  keystroke.

## Consequences

**Positive**
- No infrastructure to operate, secure, patch or pay for.
- Three of the seven baseline security controls (CORS, rate limiting, row level
  security) become structurally N/A, with a defensible reason rather than an
  excuse.
- The application works offline once loaded.

**Negative**
- The whole analysis engine must fit and run in a browser tab. This is the
  hardest constraint in the project and it drives ADR-0002.
- Remote modules become impossible without revisiting this decision, because
  fetching them requires network access.
- Sharing must work without a server, via a compressed payload in the URL
  fragment, which caps practical workspace size.
- No server-side telemetry, so we learn about failures only when users report
  them.

## Rejected alternatives

- **Minimal backend for sharing** — the moment we store other people's code we
  inherit retention, deletion, abuse and legal exposure, in exchange for nicer
  links.
- **Full backend with accounts** — adds authentication, a database, GDPR duties
  and fixed cost from day one, for features the MVP does not have.
- **Server-side parsing** — contradicts the privacy position and makes cost scale
  with usage.
