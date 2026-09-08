# Testing

The parser and the transformation pipeline take untrusted, malformed input by
design — somebody learning Terraform writes broken Terraform, and that is the
point of the tool. So the analyzer carries the heaviest testing, and the
interface is tested in a real browser rather than only in a simulated DOM.

## The layers

| Layer | Where | What it is for |
|-------|-------|----------------|
| Go unit and fixture tests | `core/internal/**` | The analyzer: parsing, evaluation, expansion, modules, placement, limits |
| Go fuzzing | `core/internal/analyzer` | Malformed input, run on every change and never yet crashing |
| TypeScript unit tests | `web/src/**/*.test.ts(x)` | The workspace, the worker client, layout, the components, the deployment Worker's headers |
| Browser tests | `web/e2e` | Accessibility and the keyboard journey, against the real build behind the real CSP |

Run everything locally with `npm run verify`, and the browser suite with
`npm run test:e2e` — which builds first, because a browser test against a stale
build is worse than no test.

## Why the browser tests exist

They are cheap to dismiss as slow duplicates of the unit tests. They are not.
The [accessibility audit](2026-09-08-accessibility-audit.md) found that
selecting a node in the diagram had never worked — not by keyboard and not by
mouse — and no unit test could have found it, because the failure only exists
where React Flow, real layout and a real browser meet.

They also run against the deployment Worker rather than a dev server, so the
Content Security Policy is the one production serves. A policy that breaks the
editor fails here instead of after a deploy.

## Audits

| Date | Report | Outcome |
|------|--------|---------|
| 2026-09-08 | [Accessibility, WCAG 2.2 AA](2026-09-08-accessibility-audit.md) | 7 defects found and fixed; no real screen reader pass yet |

## Determinism

Layout is deterministic, so diagram positions are compared as data rather than
as pixels. There is no visual regression testing and there is not meant to be:
image comparison would be slower and would fail for reasons that have nothing to
do with the product.
