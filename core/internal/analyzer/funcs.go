package analyzer

import (
	"github.com/zclconf/go-cty/cty/function"
	"github.com/zclconf/go-cty/cty/function/stdlib"

	cidrfuncs "github.com/hashicorp/go-cty-funcs/cidr"
	cryptofuncs "github.com/hashicorp/go-cty-funcs/crypto"
	encodingfuncs "github.com/hashicorp/go-cty-funcs/encoding"
	uuidfuncs "github.com/hashicorp/go-cty-funcs/uuid"
)

// functions maps Terraform's function names onto public implementations.
//
// Terraform's own function library lives under internal/ and cannot be
// imported (ADR-0002), so this table is assembled by hand from cty's stdlib
// and hashicorp/go-cty-funcs — the same packages Terraform builds its own
// wrappers on.
//
// The spike measured that these cost nothing in binary size, so breadth here
// is limited by care rather than by bytes. What is NOT in this table is
// reported as unsupported and the value becomes unknown. Approximating a
// function would be worse than omitting it: a subtly wrong answer in a
// teaching tool teaches the wrong thing.
func functions() map[string]function.Function {
	return map[string]function.Function{
		// strings
		"chomp":      stdlib.ChompFunc,
		"format":     stdlib.FormatFunc,
		"formatlist": stdlib.FormatListFunc,
		"indent":     stdlib.IndentFunc,
		"join":       stdlib.JoinFunc,
		"lower":      stdlib.LowerFunc,
		"regex":      stdlib.RegexFunc,
		"regexall":   stdlib.RegexAllFunc,
		"replace":    stdlib.ReplaceFunc,
		"split":      stdlib.SplitFunc,
		"strrev":     stdlib.ReverseFunc,
		"substr":     stdlib.SubstrFunc,
		"title":      stdlib.TitleFunc,
		"trim":       stdlib.TrimFunc,
		"trimprefix": stdlib.TrimPrefixFunc,
		"trimspace":  stdlib.TrimSpaceFunc,
		"trimsuffix": stdlib.TrimSuffixFunc,
		"upper":      stdlib.UpperFunc,

		// numbers
		"abs":      stdlib.AbsoluteFunc,
		"ceil":     stdlib.CeilFunc,
		"floor":    stdlib.FloorFunc,
		"log":      stdlib.LogFunc,
		"max":      stdlib.MaxFunc,
		"min":      stdlib.MinFunc,
		"parseint": stdlib.ParseIntFunc,
		"pow":      stdlib.PowFunc,
		"signum":   stdlib.SignumFunc,

		// collections
		"chunklist":       stdlib.ChunklistFunc,
		"coalescelist":    stdlib.CoalesceListFunc,
		"compact":         stdlib.CompactFunc,
		"concat":          stdlib.ConcatFunc,
		"contains":        stdlib.ContainsFunc,
		"distinct":        stdlib.DistinctFunc,
		"element":         stdlib.ElementFunc,
		"flatten":         stdlib.FlattenFunc,
		"keys":            stdlib.KeysFunc,
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
		"values":          stdlib.ValuesFunc,
		"zipmap":          stdlib.ZipmapFunc,

		// encoding
		"base64decode": encodingfuncs.Base64DecodeFunc,
		"base64encode": encodingfuncs.Base64EncodeFunc,
		"csvdecode":    stdlib.CSVDecodeFunc,
		"jsondecode":   stdlib.JSONDecodeFunc,
		"jsonencode":   stdlib.JSONEncodeFunc,
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
		"bcrypt": cryptofuncs.BcryptFunc,
		"md5":    cryptofuncs.Md5Func,
		"sha1":   cryptofuncs.Sha1Func,
		"sha256": cryptofuncs.Sha256Func,
		"sha512": cryptofuncs.Sha512Func,
		"uuid":   uuidfuncs.V4Func,
		"uuidv5": uuidfuncs.V5Func,
	}
}

// knownUnsupportedFunctions are Terraform functions this analyzer does not
// implement. Naming them explicitly turns a confusing parse error into a
// straight answer, which matters more in a teaching tool than coverage does.
var knownUnsupportedFunctions = map[string]string{
	"file":         "reads from disk, which the browser has no access to",
	"fileexists":   "reads from disk, which the browser has no access to",
	"filebase64":   "reads from disk, which the browser has no access to",
	"templatefile": "reads a template from disk, which the browser has no access to",
	"pathexpand":   "depends on the machine Terraform runs on",
	"timestamp":    "changes on every run, so it has no fixed value here",
	"try":          "not implemented yet",
	"can":          "not implemented yet",
	"one":          "not implemented yet",
	"sum":          "not implemented yet",
	"transpose":    "not implemented yet",
	"defaults":     "not implemented yet",
	"nonsensitive": "not implemented yet",
	"sensitive":    "not implemented yet",
	"yamldecode":   "not implemented yet",
	"yamlencode":   "not implemented yet",
}
