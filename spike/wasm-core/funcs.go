//go:build !minfuncs && !nofuncs

package main

import (
	"github.com/zclconf/go-cty/cty/function"
	"github.com/zclconf/go-cty/cty/function/stdlib"

	cidrfuncs "github.com/hashicorp/go-cty-funcs/cidr"
	cryptofuncs "github.com/hashicorp/go-cty-funcs/crypto"
	encodingfuncs "github.com/hashicorp/go-cty-funcs/encoding"
	uuidfuncs "github.com/hashicorp/go-cty-funcs/uuid"
)

// Functions maps Terraform's function names onto public implementations.
//
// This mapping is the concrete consequence of the finding in ADR-0002:
// Terraform's own function library lives under internal/ and cannot be
// imported, so the table has to be assembled by hand from cty's stdlib and
// hashicorp/go-cty-funcs.
//
// The spike covers a representative slice across several packages, which is
// what issue #1 needs in order to measure realistic binary size. The
// production table (issue #12) will be larger and will ship a coverage
// document. Functions absent from this table produce a diagnostic and an
// unknown value — they are never approximated.
func Functions() map[string]function.Function {
	return map[string]function.Function{
		// strings
		"upper":      stdlib.UpperFunc,
		"lower":      stdlib.LowerFunc,
		"title":      stdlib.TitleFunc,
		"trimspace":  stdlib.TrimSpaceFunc,
		"trim":       stdlib.TrimFunc,
		"trimprefix": stdlib.TrimPrefixFunc,
		"trimsuffix": stdlib.TrimSuffixFunc,
		"replace":    stdlib.ReplaceFunc,
		"split":      stdlib.SplitFunc,
		"join":       stdlib.JoinFunc,
		"substr":     stdlib.SubstrFunc,
		"format":     stdlib.FormatFunc,
		"formatlist": stdlib.FormatListFunc,
		"regex":      stdlib.RegexFunc,
		"regexall":   stdlib.RegexAllFunc,
		"indent":     stdlib.IndentFunc,
		"chomp":      stdlib.ChompFunc,
		"strrev":     stdlib.ReverseFunc,

		// numbers
		"abs":      stdlib.AbsoluteFunc,
		"ceil":     stdlib.CeilFunc,
		"floor":    stdlib.FloorFunc,
		"max":      stdlib.MaxFunc,
		"min":      stdlib.MinFunc,
		"pow":      stdlib.PowFunc,
		"signum":   stdlib.SignumFunc,
		"parseint": stdlib.ParseIntFunc,
		"log":      stdlib.LogFunc,

		// collections
		"concat":          stdlib.ConcatFunc,
		"contains":        stdlib.ContainsFunc,
		"distinct":        stdlib.DistinctFunc,
		"element":         stdlib.ElementFunc,
		"flatten":         stdlib.FlattenFunc,
		"keys":            stdlib.KeysFunc,
		"values":          stdlib.ValuesFunc,
		"length":          stdlib.LengthFunc,
		"lookup":          stdlib.LookupFunc,
		"merge":           stdlib.MergeFunc,
		"range":           stdlib.RangeFunc,
		"reverse":         stdlib.ReverseListFunc,
		"setintersection": stdlib.SetIntersectionFunc,
		"setproduct":      stdlib.SetProductFunc,
		"setsubtract":     stdlib.SetSubtractFunc,
		"setunion":        stdlib.SetUnionFunc,
		"slice":           stdlib.SliceFunc,
		"sort":            stdlib.SortFunc,
		"zipmap":          stdlib.ZipmapFunc,
		"coalescelist":    stdlib.CoalesceListFunc,
		"compact":         stdlib.CompactFunc,
		"chunklist":       stdlib.ChunklistFunc,

		// encoding
		"jsonencode":   stdlib.JSONEncodeFunc,
		"jsondecode":   stdlib.JSONDecodeFunc,
		"csvdecode":    stdlib.CSVDecodeFunc,
		"base64encode": encodingfuncs.Base64EncodeFunc,
		"base64decode": encodingfuncs.Base64DecodeFunc,
		"urlencode":    encodingfuncs.URLEncodeFunc,

		// dates
		"formatdate": stdlib.FormatDateFunc,
		"timeadd":    stdlib.TimeAddFunc,

		// networking
		"cidrhost":    cidrfuncs.HostFunc,
		"cidrnetmask": cidrfuncs.NetmaskFunc,
		"cidrsubnet":  cidrfuncs.SubnetFunc,
		"cidrsubnets": cidrfuncs.SubnetsFunc,

		// crypto and identity
		"md5":    cryptofuncs.Md5Func,
		"sha1":   cryptofuncs.Sha1Func,
		"sha256": cryptofuncs.Sha256Func,
		"sha512": cryptofuncs.Sha512Func,
		"bcrypt": cryptofuncs.BcryptFunc,
		"uuid":   uuidfuncs.V4Func,
		"uuidv5": uuidfuncs.V5Func,
	}
}
