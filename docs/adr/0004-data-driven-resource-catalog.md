# ADR-0004 — Data-driven resource catalog

**Status:** Accepted
**Date:** 2026-09-07

## Context

ADR-0003 commits to a containment diagram. But **Terraform does not express
containment**. `subnet_id = aws_subnet.public.id` is a reference, structurally
identical to `vpc_security_group_ids` or `kms_key_id`. Nothing in HCL says which
references mean "is inside".

The product must therefore decide, per resource type, which attribute makes a
resource a child of another, which relationships deserve an edge, and how the
resource should be presented. It must do so for AWS, Azure and GCP, and it must
survive contact with real projects full of types nobody catalogued.

## Problem

Where does that per-provider knowledge live, and how do we add providers without
rewriting the interface?

## Options considered

1. **A single JSON catalog validated by schema**, consumed by both the analyzer
   and the interface.
2. **Rules hard-coded in the analyzer**, presentation hard-coded in the UI.
3. **Provider schemas downloaded from the Terraform registry.**
4. **No catalog** — draw everything generically.

## Decision

Option 1. One schema-validated JSON catalog is the single source of truth. The Go
analyzer embeds it to compute `parentId` and edges; the interface reads icon,
display name and category from the same file.

```jsonc
{
  "type": "aws_instance",
  "provider": "aws",
  "category": "compute",
  "displayName": "EC2 Instance",
  "icon": "aws/ec2",
  "isContainer": false,
  "parentRules": [
    { "attribute": "subnet_id", "priority": 1 },
    { "attribute": "vpc_id",    "priority": 2 }
  ],
  "edgeRules": [
    { "attribute": "vpc_security_group_ids", "kind": "security", "show": false }
  ],
  "labelTemplate": "{{name}}"
}
```

**Non-negotiable companion rule:** an uncatalogued resource type is still drawn,
as a generic node in an "unplaced" area, visibly marked as uncatalogued.

## Rationale

- **Adding a provider becomes adding data.** The brief explicitly forbids
  hard-coding provider-specific rendering across the UI; this is how that is
  enforced structurally rather than by discipline.
- **Editorial work becomes parallelizable.** Catalog entries are pure data, so
  coverage can be split into independent issues and reviewed like content.
- **It is testable as data**: schema conformance, no duplicate types, referenced
  icons exist, parent rules point at plausible attributes.
- **The fallback rule protects honesty (NFR-9).** A real project will contain
  dozens of uncatalogued types. The diagram must never look empty, and must never
  look complete when it is not.
- Provider schemas were rejected as the source: they run to hundreds of megabytes
  and describe *attributes*, not *meaning* — they would tell us `subnet_id`
  exists and is a string, never that it implies containment.

## Consequences

**Positive**
- Provider support scales without touching code.
- One artifact holds every editorial decision, so they can be reviewed together.
- The interface never learns provider-specific rules.

**Negative**
- Three providers at medium depth is real, sustained editorial work — roughly
  12–15 resources each covering networking, compute, storage, databases, load
  balancing and serverless.
- Catalog quality directly determines diagram quality; a wrong parent rule
  produces a confidently wrong picture.
- Two consumers of one file can drift. Mitigated by the shared schema and tests
  on both sides.

## Rejected alternatives

- **Hard-coded rules** — every new provider would mean editing the analyzer and
  the UI, exactly what the brief prohibits.
- **Provider schemas from the registry** — enormous, network-dependent, and they
  do not encode containment meaning anyway.
- **No catalog** — would mean abandoning the containment diagram, which is the
  chosen product shape.
