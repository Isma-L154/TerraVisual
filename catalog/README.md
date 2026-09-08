# Resource catalog

Terraform has no concept of containment. `subnet_id = aws_subnet.public.id` is
structurally identical to `kms_key_id = aws_kms_key.main.id` — both are just
references. **Which of them means "lives inside" is a decision, and this is
where it is recorded.**

That makes this directory the heart of the product rather than a table of
icons. A wrong rule here produces a confidently wrong diagram, which is worse
than a missing one: the user has no reason to doubt it.

## Adding a resource type

Add an entry to the file for its provider. No code changes are needed — that is
the point of [ADR-0004](../docs/adr/0004-data-driven-resource-catalog.md), and
the tests exist to keep it true.

```jsonc
{
  "type": "aws_instance",           // the Terraform resource type
  "provider": "aws",
  "category": "compute",            // comparable across providers
  "displayName": "EC2 Instance",    // the raw type is not a label for a learner
  "icon": "aws/ec2",
  "isContainer": false,             // do other resources get drawn inside it?
  "parentRules": [
    { "attribute": "subnet_id", "priority": 1 },
    { "attribute": "vpc_id", "priority": 2 }
  ],
  "edgeRules": [
    { "attribute": "vpc_security_group_ids", "kind": "security", "show": false }
  ]
}
```

Then run `npm run generate` so the Go module picks it up, and `npm run test:core`.

## The rules, and how to get them right

**`parentRules` decide where the resource is drawn.** Lower priority wins. An
EC2 instance is inside a subnet *and* inside a VPC; listing `subnet_id` first
is what makes the diagram show the more useful of the two truths. Only the
first rule that points at a resource the workspace actually declares is used.

For a list attribute such as an ALB's `subnets`, the first target in sorted
order becomes the parent. A resource can only be drawn in one place, and a
stable choice beats an arbitrary one.

**`edgeRules` decide what is worth saying about a relationship**, and `show`
decides whether it is worth *drawing*. Security group wiring is real, useful to
record, and ruinous to draw — every instance connected to every group produces
the tangle this product exists to avoid. Set `show: false` and the relationship
stays in the model without cluttering the picture.

An attribute must not appear in both lists. An edge to the box you are already
inside says nothing.

**Categories are shared across providers on purpose.** A VPC and an Azure VNet
are both `network` so that a learner can see they play the same role. Reach for
`other` rarely: it is where meaning goes to disappear.

## What happens to types that are not here

They are still drawn, marked as uncatalogued, in the provider's box if the type
prefix identifies one. A real project brings dozens of them.

This is not a fallback to be improved away. **A diagram must never look empty,
and must never look complete when it is not.**

## Testing

`core/internal/catalog/catalog_test.go` validates every file against
[the schema](../schemas/catalog-entry.schema.json) and checks the things a
schema cannot: no duplicate types, no clashing priorities, icons matching their
provider, and no attribute serving as both a parent rule and an edge rule.

The important containment rules are asserted by name, not left to a shape
check, because they are the content rather than the format.
