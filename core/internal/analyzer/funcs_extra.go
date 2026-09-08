package analyzer

import (
	"fmt"

	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"
	"github.com/zclconf/go-cty/cty/function"
	"github.com/zclconf/go-cty/cty/function/stdlib"
)

// Terraform functions with no public implementation to borrow.
//
// Each one here is a deliberate decision to implement rather than to report as
// unsupported, and the bar is the same every time: the semantics have to be
// simple enough to be obviously right. Anything with subtle behaviour stays in
// the unsupported table, because a subtly wrong answer in a teaching tool
// teaches the wrong thing — which is worse than admitting a gap.

var sumFunc = function.New(&function.Spec{
	Params: []function.Parameter{{
		Name: "list",
		Type: cty.DynamicPseudoType,
	}},
	Type: function.StaticReturnType(cty.Number),
	Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
		if !args[0].CanIterateElements() {
			return cty.NilVal, fmt.Errorf("cannot sum a value that is not a collection")
		}
		if args[0].LengthInt() == 0 {
			return cty.NilVal, fmt.Errorf("cannot sum an empty collection")
		}

		total := cty.NumberIntVal(0)
		for it := args[0].ElementIterator(); it.Next(); {
			_, element := it.Element()
			number, err := convert.Convert(element, cty.Number)
			if err != nil {
				return cty.NilVal, fmt.Errorf("every element must be a number: %w", err)
			}
			if !number.IsKnown() {
				return cty.UnknownVal(cty.Number), nil
			}
			total = total.Add(number)
		}
		return total, nil
	},
})

// allTrue and anyTrue keep Terraform's edge cases: alltrue of nothing is true,
// anytrue of nothing is false. Getting those backwards is the classic mistake,
// so they are tested explicitly.
var allTrueFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}},
	Type:   function.StaticReturnType(cty.Bool),
	Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
		return foldBool(args[0], true)
	},
})

var anyTrueFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}},
	Type:   function.StaticReturnType(cty.Bool),
	Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
		return foldBool(args[0], false)
	},
})

func foldBool(collection cty.Value, requireAll bool) (cty.Value, error) {
	if !collection.CanIterateElements() {
		return cty.NilVal, fmt.Errorf("expected a collection of booleans")
	}

	result := requireAll
	for it := collection.ElementIterator(); it.Next(); {
		_, element := it.Element()
		boolean, err := convert.Convert(element, cty.Bool)
		if err != nil {
			return cty.NilVal, fmt.Errorf("every element must be a boolean: %w", err)
		}
		if !boolean.IsKnown() {
			return cty.UnknownVal(cty.Bool), nil
		}
		if requireAll && boolean.False() {
			return cty.False, nil
		}
		if !requireAll && boolean.True() {
			return cty.True, nil
		}
	}
	return cty.BoolVal(result), nil
}

var startsWithFunc = stringPredicate("prefix", func(s, affix string) bool {
	return len(s) >= len(affix) && s[:len(affix)] == affix
})

var endsWithFunc = stringPredicate("suffix", func(s, affix string) bool {
	return len(s) >= len(affix) && s[len(s)-len(affix):] == affix
})

var strContainsFunc = stringPredicate("substr", func(s, affix string) bool {
	if affix == "" {
		return true
	}
	for i := 0; i+len(affix) <= len(s); i++ {
		if s[i:i+len(affix)] == affix {
			return true
		}
	}
	return false
})

func stringPredicate(argument string, match func(string, string) bool) function.Function {
	return function.New(&function.Spec{
		Params: []function.Parameter{
			{Name: "str", Type: cty.String},
			{Name: argument, Type: cty.String},
		},
		Type: function.StaticReturnType(cty.Bool),
		Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
			return cty.BoolVal(match(args[0].AsString(), args[1].AsString())), nil
		},
	})
}

// one returns the single element of a one-element collection, null for an
// empty one, and an error otherwise. Terraform uses it to unwrap a resource
// that may or may not exist.
var oneFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}},
	Type: func(args []cty.Value) (cty.Type, error) {
		// A literal list in HCL is a *tuple*, not a list, and ElementType
		// panics on one. Handling both is not defensive: tuples are what a
		// user actually writes.
		ty := args[0].Type()
		switch {
		case ty.IsListType(), ty.IsSetType():
			return ty.ElementType(), nil
		case ty.IsTupleType():
			elements := ty.TupleElementTypes()
			switch len(elements) {
			case 0:
				return cty.DynamicPseudoType, nil
			case 1:
				return elements[0], nil
			default:
				return cty.NilType, fmt.Errorf(
					"must be a collection of at most one element, got %d", len(elements))
			}
		default:
			return cty.NilType, fmt.Errorf("expected a list, a set or a tuple")
		}
	},
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		switch length := args[0].LengthInt(); length {
		case 0:
			return cty.NullVal(retType), nil
		case 1:
			for it := args[0].ElementIterator(); it.Next(); {
				_, element := it.Element()
				return element, nil
			}
			return cty.NullVal(retType), nil
		default:
			return cty.NilVal, fmt.Errorf("must be a collection of at most one element, got %d", length)
		}
	},
})

// transpose swaps keys and values in a map of lists of strings.
var transposeFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "values", Type: cty.Map(cty.List(cty.String))}},
	Type:   function.StaticReturnType(cty.Map(cty.List(cty.String))),
	Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
		out := map[string][]string{}

		for it := args[0].ElementIterator(); it.Next(); {
			key, list := it.Element()
			if !list.IsKnown() {
				return cty.UnknownVal(cty.Map(cty.List(cty.String))), nil
			}
			for inner := list.ElementIterator(); inner.Next(); {
				_, value := inner.Element()
				out[value.AsString()] = append(out[value.AsString()], key.AsString())
			}
		}

		if len(out) == 0 {
			return cty.MapValEmpty(cty.List(cty.String)), nil
		}

		result := map[string]cty.Value{}
		for key, values := range out {
			items := make([]cty.Value, 0, len(values))
			for _, value := range values {
				items = append(items, cty.StringVal(value))
			}
			result[key] = cty.ListVal(items)
		}
		return cty.MapVal(result), nil
	},
})

// coalesce returns the first argument that is neither null nor an empty
// string. Terraform's own version treats "" as absent, which is the part
// people get wrong when reimplementing it.
var coalesceFunc = function.New(&function.Spec{
	Params: []function.Parameter{},
	VarParam: &function.Parameter{
		Name:             "vals",
		Type:             cty.DynamicPseudoType,
		AllowNull:        true,
		AllowDynamicType: true,
	},
	Type: func(args []cty.Value) (cty.Type, error) {
		if len(args) == 0 {
			return cty.NilType, fmt.Errorf("at least one argument is required")
		}
		return args[0].Type(), nil
	},
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		for _, argument := range args {
			if argument.IsNull() {
				continue
			}
			if !argument.IsKnown() {
				return cty.UnknownVal(retType), nil
			}
			if argument.Type() == cty.String && argument.AsString() == "" {
				continue
			}
			converted, err := convert.Convert(argument, retType)
			if err != nil {
				continue
			}
			return converted, nil
		}
		return cty.NilVal, fmt.Errorf("no argument had a value")
	},
})

// length matches Terraform's, which counts strings, collections *and*
// structural types. cty's own version rejects objects, and an object is
// exactly what `{ for k, v in ... : k => v if ... }` produces — so borrowing
// it would make a common expression fail for a reason the user could not see.
var lengthFunc = function.New(&function.Spec{
	Params: []function.Parameter{{
		Name:             "value",
		Type:             cty.DynamicPseudoType,
		AllowDynamicType: true,
		AllowUnknown:     true,
		AllowNull:        true,
	}},
	Type: function.StaticReturnType(cty.Number),
	Impl: func(args []cty.Value, _ cty.Type) (cty.Value, error) {
		value := args[0]
		if value.IsNull() {
			return cty.NilVal, fmt.Errorf("cannot take the length of a null value")
		}
		if !value.IsKnown() {
			return cty.UnknownVal(cty.Number), nil
		}

		ty := value.Type()
		switch {
		case ty == cty.String:
			return stdlib.Strlen(value)
		case ty.IsTupleType():
			return cty.NumberIntVal(int64(len(ty.TupleElementTypes()))), nil
		case ty.IsObjectType():
			return cty.NumberIntVal(int64(len(ty.AttributeTypes()))), nil
		case value.CanIterateElements():
			return cty.NumberIntVal(int64(value.LengthInt())), nil
		default:
			return cty.NilVal, fmt.Errorf("a %s has no length", ty.FriendlyName())
		}
	},
})

// extraFunctions are the ones implemented here rather than borrowed.
func extraFunctions() map[string]function.Function {
	return map[string]function.Function{
		"alltrue":     allTrueFunc,
		"anytrue":     anyTrueFunc,
		"coalesce":    coalesceFunc,
		"endswith":    endsWithFunc,
		"length":      lengthFunc,
		"one":         oneFunc,
		"startswith":  startsWithFunc,
		"strcontains": strContainsFunc,
		"sum":         sumFunc,
		"transpose":   transposeFunc,
	}
}
