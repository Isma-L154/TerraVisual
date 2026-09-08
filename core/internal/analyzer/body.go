package analyzer

import (
	"sort"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// How deep nested blocks are followed.
//
// Real configurations nest two or three levels: an ip_configuration inside a
// network interface, a setting inside a setting. The bound exists because the
// input is arbitrary, not because five is a meaningful number.
const maxBlockDepth = 5

// readBody separates a block's attributes from the blocks nested inside it.
//
// hcl's JustAttributes reports every nested block as "Blocks are not allowed
// here", which is true of the schema it assumes and false of Terraform. Most
// real resources contain blocks -- ingress, ip_configuration,
// root_block_device -- and treating each one as a syntax error would fill a
// real project's diagram with problems it does not have.
func readBody(body hcl.Body) (hcl.Attributes, []*hclsyntax.Block, hcl.Diagnostics) {
	if native, ok := body.(*hclsyntax.Body); ok {
		attributes := make(hcl.Attributes, len(native.Attributes))
		for name, attribute := range native.Attributes {
			attributes[name] = attribute.AsHCLAttribute()
		}
		return attributes, native.Blocks, nil
	}

	// JSON-syntax HCL has no separate notion of nested blocks, so the fallback
	// is correct there rather than merely tolerable.
	attributes, diags := body.JustAttributes()
	return attributes, nil, diags
}

// evaluateBody turns a resource body into model attributes.
//
// Nested blocks become attribute values: a single block an object, a repeated
// one a list of objects. That mirrors what Terraform does with them, and it is
// what lets the catalog reach inside — Azure's containment lives in
// `ip_configuration.subnet_id`, not at the top level.
func evaluateBody(
	e *evaluator,
	scope *hcl.EvalContext,
	body hcl.Body,
	prefix string,
	depth int,
	out map[string]model.Attribute,
	references map[string][]string,
	onAttribute func(path string, attr *hcl.Attribute),
) hcl.Diagnostics {
	attributes, blocks, diags := readBody(body)

	names := make([]string, 0, len(attributes))
	for name := range attributes {
		if prefix == "" && (name == "count" || name == "for_each") {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		attribute := attributes[name]
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}

		out[path] = e.evaluateAttributeIn(scope, attribute.Expr)

		for _, target := range referencedResources(attribute.Expr, e.declaredResources) {
			references[path] = append(references[path], target)
		}
		if onAttribute != nil {
			onAttribute(path, attribute)
		}
	}

	if depth >= maxBlockDepth {
		return diags
	}

	// Repeated blocks of the same type are numbered, so two ingress rules stay
	// distinguishable rather than one silently overwriting the other.
	counts := map[string]int{}
	for _, block := range blocks {
		counts[block.Type]++
	}
	seen := map[string]int{}

	for _, block := range blocks {
		path := block.Type
		if prefix != "" {
			path = prefix + "." + block.Type
		}
		if counts[block.Type] > 1 {
			path = path + "[" + itoa(seen[block.Type]) + "]"
			seen[block.Type]++
		}

		diags = append(diags, evaluateBody(e, scope, block.Body, path, depth+1, out, references, onAttribute)...)
	}

	return diags
}

// blockValues rebuilds nested blocks as cty values, so a reference to a whole
// block resolves rather than failing.
func blockValues(out map[string]model.Attribute) map[string]cty.Value {
	values := map[string]cty.Value{}
	for path, attribute := range out {
		if !attribute.Known {
			continue
		}
		value, err := nativeToCty(attribute.Value)
		if err != nil {
			continue
		}
		values[path] = value
	}
	return values
}
