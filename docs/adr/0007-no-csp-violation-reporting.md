# ADR-0007 — No CSP violation reporting in production

**Status:** Proposed
**Date:** 2026-09-09

## Context

The [baseline audit](../security/2026-09-08-baseline-audit.md) recorded that the
served Content Security Policy has no `report-to` and no `report-uri`. If the
policy started blocking something, or a dependency began trying to reach a host
it should not, nobody would find out until a user reported a broken page.

That is a real blind spot. The audit was explicit that leaving it unnamed would
be worse than having it.

## Problem

The obvious fix collides with the product's central promise. A CSP report
endpoint is a server that receives data about what visitors' browsers are doing,
and NFR-1 says user code never leaves the browser — expressed in the policy
itself as `connect-src 'self'`. Adding a reporting endpoint would be the first
exception to it.

The collision is not abstract. A violation report carries `document-uri`, and
for a shared workspace **the document URI is the workspace**: the code travels
in the URL fragment. Fragments are not sent in HTTP requests, which is what makes
sharing private — but a reporting endpoint receiving `document-uri` would be a
path by which exactly the data this architecture protects could reach a server.

## Options considered

### 1. No reporting at all

Keep the promise absolute, accept the blindness, and record it so that the next
person does not "fix" it by accident.

### 2. Report to a Cloudflare-side endpoint, with the document URI stripped

Reports reach a Worker route rather than a third party; it discards everything
except the violated directive and the blocked URI, and retains nothing per
visitor.

### 3. Detect violations in CI instead of in production

Load the application in a browser during the build, under the policy that will
actually be served, and fail the build if anything is refused. Collect nothing
from real users at all.

## Decision

**Option 3, with option 1 as the standing position for production.**

No `report-to` or `report-uri` is served. Violations are caught before a
deployment rather than after one, by the browser suite already running on every
pull request.

## Rationale

Most of what a reporting endpoint would tell us is a regression we introduced:
a new dependency mounting a stylesheet, an inline handler, a font from a CDN
somebody added without noticing. All of those break the same way in a browser
running our own tests as they would in a visitor's, and they break *before*
release rather than after.

That is not speculation — it is what the suite already does. `security.spec.ts`
loads the application, exercises the editor, the diagram, the outline and the
import panel, and fails if the console reports anything refused. The CSP nonce
work in #56 is exactly the kind of change that would break a page silently, and
this is the check that proves it did not.

What CI cannot see is a violation that happens only in the wild: a browser we do
not test, an extension injecting something, an attack in progress. Those are
worth knowing about — but not at the price of building the one server this
architecture exists to avoid, and not at the price of a data path that could
carry a shared workspace to it.

The blindness is therefore accepted, and named here so it stays a decision
rather than becoming an oversight.

## Consequences

- A CSP violation in a real user's browser is invisible to us. If a report
  arrives as "the editor is blank in browser X", the policy is the first thing to
  check.
- The browser suite becomes load-bearing for security, not only for
  accessibility. It must keep running under the deployed policy — which it does,
  because it runs against the deployment Worker rather than a dev server.
- Coverage is limited to Chromium today. Adding Firefox and WebKit to the suite
  would widen it, and is worth doing before this decision is revisited.
- If reporting is ever adopted, the `document-uri` problem must be solved first,
  and the privacy documentation must say what is collected before a single
  report is accepted.

## Rejected alternatives

**Option 2 — a stripped-down report endpoint.** Technically feasible: the Worker
already handles every request, and it could discard `document-uri` before
anything is stored. Rejected because it changes what the product *is*. Today the
honest sentence is "there is no server that receives anything about you", and it
is verifiable by watching the network. After option 2 it becomes "there is a
server, and it promises to throw most of it away" — a claim a user cannot check,
guarding against a class of problem that CI already catches. The privacy
guarantee is worth more than the telemetry.

**Option 1 alone — accept the blindness and add nothing.** This was the position
before this decision, and it is weaker for a reason that is easy to miss: it
leaves *no* mechanism, so a policy that broke the page would be found by a user.
Option 3 costs nothing extra and moves that discovery before the deployment.

## Revisit when

- The application gains a backend for some other reason, at which point the
  argument from "there is no server" no longer holds.
- Browser support diverges enough that a policy working in Chromium is no longer
  good evidence for the rest — adding Firefox and WebKit to the suite is the
  cheaper answer to that.
- Somebody reports a CSP-shaped failure we could not reproduce.
