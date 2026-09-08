# ADR-0006 — Hosting on Cloudflare Workers

**Status:** Accepted
**Date:** 2026-09-07

## Context

ADR-0001 leaves a purely static artifact: a directory of files, with no server
logic. That makes hosting unusually easy to change, but two requirements
constrain the choice.

First, the security model leans heavily on control 7 — a strict Content Security
Policy. WebAssembly needs `script-src 'self' 'wasm-unsafe-eval'`, which permits
compiling WASM **without** opening `unsafe-eval`. That directive is supported
across all major browsers, but it must actually be served, so we need real
control over response headers.

Second, the project owner already operates Cloudflare with a custom domain and
CLI access.

## Problem

Where is the static artifact served from, and how are security headers
guaranteed?

## Options considered

1. **Cloudflare Workers** with static assets.
2. **Cloudflare Pages.**
3. **Netlify or Vercel.**
4. **GitHub Pages.**

## Decision

Cloudflare Workers, serving the static assets, with the Worker itself setting the
security headers.

## Rationale

- **Headers are code, and code is testable.** Setting CSP, HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`, `object-src`
  and `base-uri` in the Worker means they can be asserted by tests against a real
  response — which is exactly what the audit baseline demands, since it forbids
  inferring a control from configuration.
- **Correct `.wasm` handling** and cache behavior are under our control.
- **It is already the owner's platform**, with a domain and CLI access in place,
  so it adds no new vendor, account or cost.
- GitHub Pages was rejected specifically on this axis: limited header control
  makes a strict CSP awkward, and there are no per-PR preview deployments.

## Consequences

**Positive**
- Security headers are part of the codebase and verifiable in CI.
- Preview deployments per pull request.
- No server to operate despite having programmable request handling.

**Negative**
- Some vendor coupling, though limited: the Worker is a thin header-setting
  wrapper around static files, and the artifact itself is portable.
- Deployment requires Cloudflare credentials in CI, which become the project's
  only real secret and must be handled under baseline control 1.

## Rejected alternatives

- **Cloudflare Pages** — viable, but header control is file-based rather than
  code, and Workers is where the platform is heading.
- **Netlify / Vercel** — perfectly capable, but they would add a vendor for no
  gain over infrastructure the owner already runs.
- **GitHub Pages** — weakest header control of the four and no PR previews, which
  undermines both the security model and the review workflow.
