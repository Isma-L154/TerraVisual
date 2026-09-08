package analyzer

import (
	"sort"

	"github.com/zclconf/go-cty/cty"

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
	table := map[string]function.Function{
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
		"chunklist":    stdlib.ChunklistFunc,
		"coalescelist": stdlib.CoalesceListFunc,
		"compact":      stdlib.CompactFunc,
		"concat":       stdlib.ConcatFunc,
		"contains":     stdlib.ContainsFunc,
		"distinct":     stdlib.DistinctFunc,
		"element":      stdlib.ElementFunc,
		"flatten":      stdlib.FlattenFunc,
		"keys":         stdlib.KeysFunc,
		// Overridden by extraFunctions: cty's version rejects objects.
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

		// type conversion
		//
		// Common enough that leaving them out made toset(...) in a for_each
		// fail for a reason that looked like a problem with for_each.
		"tobool":   stdlib.MakeToFunc(cty.Bool),
		"tolist":   stdlib.MakeToFunc(cty.List(cty.DynamicPseudoType)),
		"tomap":    stdlib.MakeToFunc(cty.Map(cty.DynamicPseudoType)),
		"tonumber": stdlib.MakeToFunc(cty.Number),
		"toset":    stdlib.MakeToFunc(cty.Set(cty.DynamicPseudoType)),
		"tostring": stdlib.MakeToFunc(cty.String),

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

	// The ones with no public implementation to borrow, written here.
	for name, implementation := range extraFunctions() {
		table[name] = implementation
	}

	return table
}

// SupportedFunctions lists the Terraform functions this analyzer evaluates.
// Exported so the coverage document is generated from the table itself rather
// than from a list somebody has to remember to update.
func SupportedFunctions() []string {
	names := make([]string, 0, len(functions()))
	for name := range functions() {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// UnsupportedFunctions lists what is deliberately not implemented, with the
// reason a user will read.
func UnsupportedFunctions() map[string]string {
	out := make(map[string]string, len(knownUnsupportedFunctions))
	for name, reason := range knownUnsupportedFunctions {
		out[name] = reason
	}
	return out
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
	"yamldecode":   "not implemented yet",
	"yamlencode":   "not implemented yet",

	// These are not merely unimplemented: they are about error handling and
	// about values Terraform marks sensitive, and both depend on machinery
	// this analyzer does not have. Guessing at them would produce answers that
	// look right and are not.
	"try":          "catches evaluation errors, which this analyzer reports rather than swallows",
	"can":          "tests whether an expression errors, which this analyzer reports instead",
	"sensitive":    "marks a value sensitive, and nothing here tracks that marking",
	"nonsensitive": "removes a sensitive marking, and nothing here tracks that marking",
	"defaults":     "deprecated in Terraform and not implemented here",
}
