package analyzer

import (
	"github.com/hashicorp/hcl/v2"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

var providerBlockSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "region"},
		{Name: "alias"},
		{Name: "project"},
	},
}

// detectRegions reads the region out of provider configuration.
//
// Resources do not declare where they live; the provider block does. That
// makes the region knowable exactly when there is one unambiguous answer, so
// this deliberately gives up rather than guessing:
//
//   - several provider blocks for the same provider (aliases) means resources
//     may be split between regions, and nothing in the resource says which;
//   - a region built from a variable with no default is not determinable.
//
// When it gives up, the diagram simply has no region layer. That is a smaller
// lie than putting everything in a region half of it is not in.
func detectRegions(e *evaluator, p parsed, diags *diagnostics) map[string]string {
	type candidate struct {
		region string
		blocks int
		source model.Range
	}

	found := map[string]*candidate{}

	for _, block := range p.providers {
		name := providerFor(block.Labels[0] + "_")
		if name == "unknown" {
			name = block.Labels[0]
		}

		if found[name] == nil {
			found[name] = &candidate{source: toRange(block.DefRange)}
		}
		found[name].blocks++

		content, _, contentDiags := block.Body.PartialContent(providerBlockSchema)
		diags.addHCL(contentDiags)
		if content == nil {
			continue
		}
		if _, aliased := content.Attributes["alias"]; aliased {
			continue
		}

		attr, ok := content.Attributes["region"]
		if !ok {
			continue
		}
		attribute := e.evaluateAttribute(attr.Expr)
		if !attribute.Known {
			diags.add(model.Diagnostic{
				Severity: "info",
				Code:     "region-not-determinable",
				Message: "The provider's region could not be determined, so resources are not grouped by region: " +
					attribute.Reason,
				Source: toRange(attr.Range),
			})
			continue
		}
		if region, isString := attribute.Value.(string); isString && region != "" {
			found[name].region = region
		}
	}

	regions := map[string]string{}
	for provider, c := range found {
		if c.region == "" {
			continue
		}
		if c.blocks > 1 {
			diags.add(model.Diagnostic{
				Severity: "info",
				Code:     "multiple-provider-blocks",
				Message: "This workspace configures " + provider +
					" more than once, so resources are not grouped by region: which one applies is not visible in the resource itself.",
				Source: c.source,
			})
			continue
		}
		regions[provider] = c.region
	}

	return regions
}
