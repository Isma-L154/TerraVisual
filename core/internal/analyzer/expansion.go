package analyzer

import (
	"fmt"
	"sort"

	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Expansion limits.
//
// These are security control 3 in practice. `count = 100000` is a plausible
// typo, and with no server between the user and this code, the browser tab is
// what an accident or an attacker can exhaust. Generous for real
// infrastructure and firmly finite.
const (
	MaxInstancesPerResource = 1000
	MaxTotalInstances       = 20000
)

// instance is one expanded copy of a resource block.
type instance struct {
	// suffix is what distinguishes this instance in an address: "[0]" or
	// [\"blue\"]. Empty when the block is not expanded at all.
	suffix string
	// scope holds count.index or each.key/each.value for this instance.
	scope map[string]cty.Value
	// expansion is recorded on the node so the interface can say which of many
	// instances this is, and whether the set was truncated.
	expansion *model.Expansion
}

// expandBlock decides how many instances a resource block produces.
//
// When the count or the for_each cannot be determined, the block produces one
// instance marked as an undetermined number, rather than a guess. Showing one
// box and saying "we do not know how many" is honest; showing three because
// three looked plausible is not.
func expandBlock(e *evaluator, block *hcl.Block, attrs hcl.Attributes, address string, report bool, diags *diagnostics) []instance {
	countAttr, hasCount := attrs["count"]
	forEachAttr, hasForEach := attrs["for_each"]

	switch {
	case hasCount && hasForEach:
		if report {
			diags.add(model.Diagnostic{
				Severity: "error",
				Code:     "count-and-for-each",
				Message: fmt.Sprintf(
					"%s uses both count and for_each. Terraform allows only one.", address),
				Source: toRange(countAttr.Range),
			})
		}
		return []instance{{}}

	case hasCount:
		return expandCount(e, countAttr, address, report, diags)

	case hasForEach:
		return expandForEach(e, forEachAttr, address, report, diags)

	default:
		return []instance{{}}
	}
}

func expandCount(e *evaluator, attr *hcl.Attribute, address string, report bool, diags *diagnostics) []instance {
	attribute := e.evaluateAttribute(attr.Expr)
	if !attribute.Known {
		if report {
			diags.add(model.Diagnostic{
				Severity: "info",
				Code:     "expansion-not-determinable",
				Message: fmt.Sprintf(
					"How many instances of %s exist cannot be determined here: %s",
					address, attribute.Reason),
				Source: toRange(attr.Range),
			})
		}
		return []instance{{expansion: &model.Expansion{Kind: "count"}}}
	}

	number, ok := attribute.Value.(float64)
	if !ok || number < 0 || number != float64(int(number)) {
		if report {
			diags.add(model.Diagnostic{
				Severity: "error",
				Code:     "invalid-count",
				Message: fmt.Sprintf(
					"count on %s must be a whole number that is not negative.", address),
				Source: toRange(attr.Range),
			})
		}
		return []instance{{expansion: &model.Expansion{Kind: "count"}}}
	}

	total := int(number)
	shown := total
	truncated := false
	if shown > MaxInstancesPerResource {
		shown = MaxInstancesPerResource
		truncated = true
		if report {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "expansion-truncated",
				Message: fmt.Sprintf(
					"%s declares %d instances. Only the first %d are shown.",
					address, total, MaxInstancesPerResource),
				Source: toRange(attr.Range),
			})
		}
	}

	instances := make([]instance, 0, shown)
	for i := 0; i < shown; i++ {
		index := i
		count := total
		instances = append(instances, instance{
			suffix: fmt.Sprintf("[%d]", i),
			scope: map[string]cty.Value{
				"count": cty.ObjectVal(map[string]cty.Value{"index": cty.NumberIntVal(int64(i))}),
			},
			expansion: &model.Expansion{
				Kind:      "count",
				Index:     &index,
				Total:     &count,
				Truncated: truncated,
			},
		})
	}
	return instances
}

func expandForEach(e *evaluator, attr *hcl.Attribute, address string, report bool, diags *diagnostics) []instance {
	value, valueDiags := attr.Expr.Value(e.ctx)
	if valueDiags.HasErrors() || !value.IsWhollyKnown() {
		reason := e.explain(attr.Expr, "it is not determinable without running Terraform")
		if report {
			diags.add(model.Diagnostic{
				Severity: "info",
				Code:     "expansion-not-determinable",
				Message: fmt.Sprintf(
					"How many instances of %s exist cannot be determined here: %s", address, reason),
				Source: toRange(attr.Range),
			})
		}
		return []instance{{expansion: &model.Expansion{Kind: "for_each"}}}
	}

	if value.IsNull() || !value.CanIterateElements() {
		if report {
			diags.add(model.Diagnostic{
				Severity: "error",
				Code:     "invalid-for-each",
				Message: fmt.Sprintf(
					"for_each on %s must be a map or a set of strings.", address),
				Source: toRange(attr.Range),
			})
		}
		return []instance{{expansion: &model.Expansion{Kind: "for_each"}}}
	}

	// Keys are collected and sorted before instances are built, so the same
	// configuration always produces the same order — a map's iteration order
	// would otherwise reshuffle the diagram between identical runs.
	type entry struct {
		key   string
		value cty.Value
	}
	var entries []entry

	isSet := value.Type().IsSetType()
	for it := value.ElementIterator(); it.Next(); {
		key, element := it.Element()

		if isSet {
			// A set's key is its own element, which Terraform requires to be a
			// string for exactly this reason.
			text, err := convert.Convert(element, cty.String)
			if err != nil {
				if report {
					diags.add(model.Diagnostic{
						Severity: "error",
						Code:     "invalid-for-each",
						Message: fmt.Sprintf(
							"for_each on %s is a set, so every element must be a string.", address),
						Source: toRange(attr.Range),
					})
				}
				return []instance{{expansion: &model.Expansion{Kind: "for_each"}}}
			}
			entries = append(entries, entry{key: text.AsString(), value: element})
			continue
		}

		text, err := convert.Convert(key, cty.String)
		if err != nil {
			continue
		}
		entries = append(entries, entry{key: text.AsString(), value: element})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].key < entries[j].key })

	total := len(entries)
	truncated := false
	if len(entries) > MaxInstancesPerResource {
		entries = entries[:MaxInstancesPerResource]
		truncated = true
		if report {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "expansion-truncated",
				Message: fmt.Sprintf(
					"%s declares %d instances. Only the first %d are shown.",
					address, total, MaxInstancesPerResource),
				Source: toRange(attr.Range),
			})
		}
	}

	instances := make([]instance, 0, len(entries))
	for _, item := range entries {
		count := total
		instances = append(instances, instance{
			suffix: fmt.Sprintf("[%q]", item.key),
			scope: map[string]cty.Value{
				"each": cty.ObjectVal(map[string]cty.Value{
					"key":   cty.StringVal(item.key),
					"value": item.value,
				}),
			},
			expansion: &model.Expansion{
				Kind:      "for_each",
				Key:       item.key,
				Total:     &count,
				Truncated: truncated,
			},
		})
	}
	return instances
}
