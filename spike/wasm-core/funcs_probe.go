//go:build minfuncs || nofuncs

package main

import (
	"github.com/zclconf/go-cty/cty/function"
	"github.com/zclconf/go-cty/cty/function/stdlib"
)

// Size-probe variants of the function table, used only to attribute binary
// size to its causes. Built with -tags minfuncs (cty stdlib only) or
// -tags nofuncs (no functions at all), never shipped.
func Functions() map[string]function.Function {
	if noFunctions {
		return map[string]function.Function{}
	}
	return map[string]function.Function{
		"upper":      stdlib.UpperFunc,
		"lower":      stdlib.LowerFunc,
		"title":      stdlib.TitleFunc,
		"trimspace":  stdlib.TrimSpaceFunc,
		"replace":    stdlib.ReplaceFunc,
		"split":      stdlib.SplitFunc,
		"join":       stdlib.JoinFunc,
		"substr":     stdlib.SubstrFunc,
		"format":     stdlib.FormatFunc,
		"formatlist": stdlib.FormatListFunc,
		"abs":        stdlib.AbsoluteFunc,
		"ceil":       stdlib.CeilFunc,
		"floor":      stdlib.FloorFunc,
		"max":        stdlib.MaxFunc,
		"min":        stdlib.MinFunc,
		"concat":     stdlib.ConcatFunc,
		"contains":   stdlib.ContainsFunc,
		"distinct":   stdlib.DistinctFunc,
		"element":    stdlib.ElementFunc,
		"flatten":    stdlib.FlattenFunc,
		"keys":       stdlib.KeysFunc,
		"values":     stdlib.ValuesFunc,
		"length":     stdlib.LengthFunc,
		"lookup":     stdlib.LookupFunc,
		"merge":      stdlib.MergeFunc,
		"range":      stdlib.RangeFunc,
		"sort":       stdlib.SortFunc,
		"zipmap":     stdlib.ZipmapFunc,
		"jsonencode": stdlib.JSONEncodeFunc,
		"jsondecode": stdlib.JSONDecodeFunc,
	}
}
