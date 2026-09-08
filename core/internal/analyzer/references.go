package analyzer

import (
	"fmt"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

// traversalAddress renders a traversal the way the user wrote it, so messages
// and references speak the language of the source rather than of the parser.
func traversalAddress(traversal hcl.Traversal) string {
	var parts []string
	for _, step := range traversal {
		switch t := step.(type) {
		case hcl.TraverseRoot:
			parts = append(parts, t.Name)
		case hcl.TraverseAttr:
			parts = append(parts, t.Name)
		case hcl.TraverseIndex:
			if t.Key.Type() == cty.String {
				parts = append(parts, fmt.Sprintf("[%q]", t.Key.AsString()))
			} else if t.Key.Type() == cty.Number {
				parts = append(parts, fmt.Sprintf("[%s]", t.Key.AsBigFloat().String()))
			}
		}
	}
	return strings.Join(parts, ".")
}

// trimToAddress keeps the first n dotted segments, so a long traversal can be
// named by the thing it refers to rather than repeated in full.
func trimToAddress(address string, n int) string {
	parts := strings.Split(address, ".")
	if len(parts) <= n {
		return address
	}
	return strings.Join(parts[:n], ".")
}

// calledFunctions collects every function called anywhere in an expression,
// including nested calls. One walk per expression rather than one per
// candidate name, which matters when the analyzer runs on every keystroke.
func calledFunctions(expr hcl.Expression) []string {
	node, ok := expr.(hclsyntax.Node)
	if !ok {
		// JSON-syntax HCL has no walkable node tree here. Returning nothing is
		// correct rather than convenient: we report what we can see.
		return nil
	}

	var names []string
	hclsyntax.VisitAll(node, func(n hclsyntax.Node) hcl.Diagnostics {
		if call, ok := n.(*hclsyntax.FunctionCallExpr); ok {
			names = append(names, call.Name)
		}
		return nil
	})
	return names
}

// referencedResources lists the resources an expression depends on, as
// addresses like "aws_subnet.public".
//
// This is the "explicit references" the analyzer is asked to detect. It is
// derived from the syntax rather than from evaluation, so it works even when
// the value itself cannot be determined — which is the common case, since most
// references point at attributes Terraform computes on apply.
func referencedResources(expr hcl.Expression, declared map[string]bool) []string {
	var found []string
	seen := map[string]bool{}

	for _, traversal := range expr.Variables() {
		address := traversalAddress(traversal)
		short := trimToAddress(address, 2)
		if !declared[short] || seen[short] {
			continue
		}
		seen[short] = true
		found = append(found, short)
	}
	return found
}

// ctyToNative converts an evaluated value into something encoding/json
// understands. It never guesses: anything it cannot represent returns an
// error, which the caller reports as unknown.
func ctyToNative(value cty.Value) (any, error) {
	if value.IsNull() {
		return nil, nil
	}
	if !value.IsKnown() {
		return nil, fmt.Errorf("it is not determinable without running Terraform")
	}

	t := value.Type()
	switch {
	case t == cty.String:
		return value.AsString(), nil
	case t == cty.Bool:
		return value.True(), nil
	case t == cty.Number:
		f, _ := value.AsBigFloat().Float64()
		return f, nil
	case t.IsListType(), t.IsSetType(), t.IsTupleType():
		out := []any{}
		for it := value.ElementIterator(); it.Next(); {
			_, element := it.Element()
			converted, err := ctyToNative(element)
			if err != nil {
				return nil, err
			}
			out = append(out, converted)
		}
		return out, nil
	case t.IsMapType(), t.IsObjectType():
		out := map[string]any{}
		for it := value.ElementIterator(); it.Next(); {
			key, element := it.Element()
			converted, err := ctyToNative(element)
			if err != nil {
				return nil, err
			}
			out[key.AsString()] = converted
		}
		return out, nil
	default:
		return nil, fmt.Errorf("its type (%s) cannot be represented here", t.FriendlyName())
	}
}

// nativeToCty converts back, so a value evaluated in one resource can be
// referenced from another.
func nativeToCty(value any) (cty.Value, error) {
	switch v := value.(type) {
	case nil:
		return cty.NullVal(cty.DynamicPseudoType), nil
	case string:
		return cty.StringVal(v), nil
	case bool:
		return cty.BoolVal(v), nil
	case float64:
		return cty.NumberFloatVal(v), nil
	case int:
		return cty.NumberIntVal(int64(v)), nil
	case []any:
		if len(v) == 0 {
			return cty.EmptyTupleVal, nil
		}
		elements := make([]cty.Value, 0, len(v))
		for _, element := range v {
			converted, err := nativeToCty(element)
			if err != nil {
				return cty.NilVal, err
			}
			elements = append(elements, converted)
		}
		return cty.TupleVal(elements), nil
	case map[string]any:
		if len(v) == 0 {
			return cty.EmptyObjectVal, nil
		}
		attrs := map[string]cty.Value{}
		for key, element := range v {
			converted, err := nativeToCty(element)
			if err != nil {
				return cty.NilVal, err
			}
			attrs[key] = converted
		}
		return cty.ObjectVal(attrs), nil
	default:
		return cty.NilVal, fmt.Errorf("unsupported value of type %T", value)
	}
}
