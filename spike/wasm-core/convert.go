package main

import (
	"fmt"

	"github.com/zclconf/go-cty/cty"
)

// ctyToNative turns a cty value into something encoding/json understands.
// It never guesses: anything it cannot represent returns an error, which the
// caller reports as an unknown value rather than papering over.
func ctyToNative(v cty.Value) (interface{}, error) {
	if v.IsNull() {
		return nil, nil
	}
	if !v.IsKnown() {
		return nil, fmt.Errorf("value is not known statically")
	}

	t := v.Type()
	switch {
	case t == cty.String:
		return v.AsString(), nil
	case t == cty.Bool:
		return v.True(), nil
	case t == cty.Number:
		f, _ := v.AsBigFloat().Float64()
		return f, nil
	case t.IsListType(), t.IsSetType(), t.IsTupleType():
		out := []interface{}{}
		for it := v.ElementIterator(); it.Next(); {
			_, ev := it.Element()
			nv, err := ctyToNative(ev)
			if err != nil {
				return nil, err
			}
			out = append(out, nv)
		}
		return out, nil
	case t.IsMapType(), t.IsObjectType():
		out := map[string]interface{}{}
		for it := v.ElementIterator(); it.Next(); {
			kv, ev := it.Element()
			nv, err := ctyToNative(ev)
			if err != nil {
				return nil, err
			}
			out[kv.AsString()] = nv
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unsupported type %s", t.FriendlyName())
	}
}

func goctyToInt(v cty.Value, out *int) error {
	if v.IsNull() || !v.IsKnown() {
		return fmt.Errorf("not a known number")
	}
	bf := v.AsBigFloat()
	i64, acc := bf.Int64()
	if acc != 0 {
		return fmt.Errorf("not an integer")
	}
	*out = int(i64)
	return nil
}
