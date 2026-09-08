// Package main is a throwaway spike (issue #1). It exists to answer one
// question with numbers: can hashicorp/hcl plus go-cty, compiled to
// WebAssembly, evaluate Terraform inside a browser tab within our size and
// latency budgets?
//
// It is deliberately not the production analyzer. It has no catalog, no
// containment rules and no module support. Do not build on it.
package main

import (
	"fmt"
	"sort"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"
)

// Result is what crosses the WASM boundary, serialised as JSON.
type Result struct {
	Resources   []Resource   `json:"resources"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Stats       Stats        `json:"stats"`
}

type Resource struct {
	Address    string               `json:"address"`
	Type       string               `json:"type"`
	Name       string               `json:"name"`
	Index      *int                 `json:"index,omitempty"`
	Attributes map[string]Attribute `json:"attributes"`
	Source     Range                `json:"source"`
}

// Attribute carries the honesty requirement (NFR-9) in its shape: a value the
// evaluator could not determine is reported as unknown with a reason, never
// guessed and never silently blank.
type Attribute struct {
	Known  bool        `json:"known"`
	Value  interface{} `json:"value,omitempty"`
	Reason string      `json:"reason,omitempty"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
	Detail   string `json:"detail,omitempty"`
	Source   Range  `json:"source"`
}

type Range struct {
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	StartCol  int    `json:"startCol"`
	EndLine   int    `json:"endLine"`
	EndCol    int    `json:"endCol"`
}

type Stats struct {
	Files     int  `json:"files"`
	Resources int  `json:"resources"`
	Truncated bool `json:"truncated"`
}

// Limits keep hostile or accidental input from freezing the tab. In the
// production analyzer these become security control 3 (issue #13); here they
// exist so the measurements cannot be gamed by an unbounded expansion.
const (
	maxCountPerResource = 1000
	maxTotalResources   = 20000
)

var fileSchema = &hcl.BodySchema{
	Blocks: []hcl.BlockHeaderSchema{
		{Type: "variable", LabelNames: []string{"name"}},
		{Type: "locals"},
		{Type: "resource", LabelNames: []string{"type", "name"}},
	},
}

var variableSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "default"},
		{Name: "type"},
		{Name: "description"},
	},
}

// Analyze parses every file, resolves variables and locals, then evaluates
// each resource body. It always returns a result: broken input produces
// diagnostics, never a panic and never an empty response (NFR-7).
func Analyze(files map[string]string) Result {
	res := Result{
		Resources:   []Resource{},
		Diagnostics: []Diagnostic{},
	}

	parser := hclparse.NewParser()

	// Parse everything first so a syntax error in one file does not hide the
	// resources in the others. While the user types, most files are broken
	// most of the time, so partial output is the normal case.
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	bodies := make([]hcl.Body, 0, len(names))
	for _, name := range names {
		f, diags := parser.ParseHCL([]byte(files[name]), name)
		res.appendDiags(diags)
		if f != nil {
			bodies = append(bodies, f.Body)
		}
	}
	res.Stats.Files = len(names)

	// Collect blocks across all files.
	var variableBlocks, resourceBlocks []*hcl.Block
	var localsBodies []hcl.Body
	for _, body := range bodies {
		content, _, diags := body.PartialContent(fileSchema)
		res.appendDiags(diags)
		if content == nil {
			continue
		}
		for _, b := range content.Blocks {
			switch b.Type {
			case "variable":
				variableBlocks = append(variableBlocks, b)
			case "locals":
				localsBodies = append(localsBodies, b.Body)
			case "resource":
				resourceBlocks = append(resourceBlocks, b)
			}
		}
	}

	ctx := &hcl.EvalContext{
		Variables: map[string]cty.Value{},
		Functions: Functions(),
	}

	vars := map[string]cty.Value{}
	for _, b := range variableBlocks {
		content, _, diags := b.Body.PartialContent(variableSchema)
		res.appendDiags(diags)
		if content == nil {
			continue
		}
		name := b.Labels[0]
		attr, ok := content.Attributes["default"]
		if !ok {
			// A variable with no default is genuinely unknown until someone
			// supplies a value. Saying so is the point.
			vars[name] = cty.DynamicVal
			continue
		}
		v, diags := attr.Expr.Value(ctx)
		res.appendDiags(diags)
		vars[name] = v
	}
	ctx.Variables["var"] = cty.ObjectVal(nonEmpty(vars))

	// Locals may reference each other in any order, so resolve to a fixpoint
	// rather than assuming declaration order.
	locals := map[string]cty.Value{}
	type pendingLocal struct {
		name string
		expr hcl.Expression
	}
	var pending []pendingLocal
	for _, body := range localsBodies {
		attrs, diags := body.JustAttributes()
		res.appendDiags(diags)
		keys := make([]string, 0, len(attrs))
		for k := range attrs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			pending = append(pending, pendingLocal{name: k, expr: attrs[k].Expr})
		}
	}
	// The bound must be captured before the loop: pending shrinks as locals
	// resolve, and using it directly as the limit would tighten the bound on
	// every pass and abandon the deepest dependency chains half-resolved.
	maxPasses := len(pending) + 1
	for pass := 0; pass < maxPasses && len(pending) > 0; pass++ {
		ctx.Variables["local"] = cty.ObjectVal(nonEmpty(locals))
		var stillPending []pendingLocal
		progressed := false
		for _, p := range pending {
			v, diags := p.expr.Value(ctx)
			if diags.HasErrors() {
				stillPending = append(stillPending, p)
				continue
			}
			locals[p.name] = v
			progressed = true
		}
		pending = stillPending
		if !progressed {
			break
		}
	}
	// Whatever never resolved is reported, not silently dropped.
	for _, p := range pending {
		locals[p.name] = cty.DynamicVal
		rng := p.expr.Range()
		res.Diagnostics = append(res.Diagnostics, Diagnostic{
			Severity: "warning",
			Summary:  fmt.Sprintf("local.%s could not be resolved", p.name),
			Detail:   "It depends on a value this spike cannot determine.",
			Source:   toRange(rng),
		})
	}
	ctx.Variables["local"] = cty.ObjectVal(nonEmpty(locals))

	for _, b := range resourceBlocks {
		res.evalResource(ctx, b)
		if len(res.Resources) >= maxTotalResources {
			res.Stats.Truncated = true
			break
		}
	}

	res.Stats.Resources = len(res.Resources)
	return res
}

func (r *Result) evalResource(ctx *hcl.EvalContext, b *hcl.Block) {
	rType, rName := b.Labels[0], b.Labels[1]
	attrs, diags := b.Body.JustAttributes()
	r.appendDiags(diags)

	count := 1
	indexed := false
	if countAttr, ok := attrs["count"]; ok {
		indexed = true
		v, d := countAttr.Expr.Value(ctx)
		r.appendDiags(d)
		if v.IsKnown() && !v.IsNull() {
			if n, err := convert.Convert(v, cty.Number); err == nil {
				var i int
				if err := goctyToInt(n, &i); err == nil {
					count = i
				}
			}
		} else {
			// An undeterminable count means we do not know how many instances
			// exist. One node, honestly labelled, beats a fabricated number.
			count = 1
			indexed = false
			r.Diagnostics = append(r.Diagnostics, Diagnostic{
				Severity: "warning",
				Summary:  fmt.Sprintf("count on %s.%s is not determinable", rType, rName),
				Source:   toRange(countAttr.Range),
			})
		}
		if count > maxCountPerResource {
			count = maxCountPerResource
			r.Stats.Truncated = true
		}
		if count < 0 {
			count = 0
		}
	}

	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		if k == "count" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for i := 0; i < count; i++ {
		child := ctx.NewChild()
		child.Variables = map[string]cty.Value{}
		if indexed {
			child.Variables["count"] = cty.ObjectVal(map[string]cty.Value{
				"index": cty.NumberIntVal(int64(i)),
			})
		}

		out := Resource{
			Type:       rType,
			Name:       rName,
			Attributes: map[string]Attribute{},
			Source:     toRange(b.DefRange),
		}
		if indexed {
			idx := i
			out.Index = &idx
			out.Address = fmt.Sprintf("%s.%s[%d]", rType, rName, i)
		} else {
			out.Address = fmt.Sprintf("%s.%s", rType, rName)
		}

		for _, k := range keys {
			v, d := attrs[k].Expr.Value(child)
			if d.HasErrors() {
				out.Attributes[k] = Attribute{
					Known:  false,
					Reason: d.Error(),
				}
				continue
			}
			out.Attributes[k] = toAttribute(v)
		}

		r.Resources = append(r.Resources, out)
		if len(r.Resources) >= maxTotalResources {
			r.Stats.Truncated = true
			return
		}
	}
}

func toAttribute(v cty.Value) Attribute {
	if !v.IsWhollyKnown() {
		return Attribute{Known: false, Reason: "value is not known statically"}
	}
	if v.IsNull() {
		return Attribute{Known: true, Value: nil}
	}
	native, err := ctyToNative(v)
	if err != nil {
		return Attribute{Known: false, Reason: err.Error()}
	}
	return Attribute{Known: true, Value: native}
}

func (r *Result) appendDiags(diags hcl.Diagnostics) {
	for _, d := range diags {
		severity := "error"
		if d.Severity == hcl.DiagWarning {
			severity = "warning"
		}
		var rng Range
		if d.Subject != nil {
			rng = toRange(*d.Subject)
		}
		r.Diagnostics = append(r.Diagnostics, Diagnostic{
			Severity: severity,
			Summary:  d.Summary,
			Detail:   d.Detail,
			Source:   rng,
		})
	}
}

func toRange(r hcl.Range) Range {
	return Range{
		File:      r.Filename,
		StartLine: r.Start.Line,
		StartCol:  r.Start.Column,
		EndLine:   r.End.Line,
		EndCol:    r.End.Column,
	}
}

// nonEmpty keeps cty.ObjectVal from panicking on an empty map.
func nonEmpty(m map[string]cty.Value) map[string]cty.Value {
	if len(m) == 0 {
		return map[string]cty.Value{"__empty": cty.StringVal("")}
	}
	return m
}
