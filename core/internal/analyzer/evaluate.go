package analyzer

import (
	"fmt"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// resourceEvaluationPasses bounds the fixpoint over resources.
//
// Each pass lets values written literally in one resource become visible to
// another that references them. Three is enough for the chains that occur in
// practice, and the bound matters more than the depth: an unbounded fixpoint
// over user input is a denial of service waiting to happen.
const resourceEvaluationPasses = 3

// computedAttributes are attributes Terraform assigns when it creates the
// infrastructure. They exist on almost every resource and are referenced
// constantly, so seeding them as unknown produces an honest answer instead of
// "this object has no attribute named id".
var computedAttributes = []string{"id", "arn"}

type evaluator struct {
	ctx   *hcl.EvalContext
	diags *diagnostics

	// declared records what exists, so a failed reference can be explained in
	// terms the user recognises rather than as a parser error.
	declaredResources map[string]bool
	declaredData      map[string]bool
	variablesNoValue  map[string]bool
}

func newEvaluator(diags *diagnostics) *evaluator {
	return &evaluator{
		ctx: &hcl.EvalContext{
			Variables: map[string]cty.Value{},
			Functions: functions(),
		},
		diags:             diags,
		declaredResources: map[string]bool{},
		declaredData:      map[string]bool{},
		variablesNoValue:  map[string]bool{},
	}
}

// resolveVariables evaluates input variable defaults.
//
// A variable without a default is genuinely undeterminable until someone
// supplies a value, so it becomes unknown rather than an empty string. The
// name is remembered so anything depending on it can say why.
func (e *evaluator) resolveVariables(blocks []*hcl.Block) {
	values := map[string]cty.Value{}

	for _, block := range blocks {
		name := block.Labels[0]
		content, _, diags := block.Body.PartialContent(variableSchema)
		e.diags.addHCL(diags)
		if content == nil {
			continue
		}

		attr, ok := content.Attributes["default"]
		if !ok {
			values[name] = cty.DynamicVal
			e.variablesNoValue[name] = true
			continue
		}

		value, valueDiags := attr.Expr.Value(e.ctx)
		if valueDiags.HasErrors() {
			e.diags.addHCL(valueDiags)
			values[name] = cty.DynamicVal
			e.variablesNoValue[name] = true
			continue
		}
		values[name] = value
	}

	e.ctx.Variables["var"] = objectOrPlaceholder(values)
}

// resolveLocals resolves locals to a fixpoint, so declaration order does not
// matter — Terraform does not require it, and neither should we.
func (e *evaluator) resolveLocals(bodies []hcl.Body) {
	type pending struct {
		name string
		expr hcl.Expression
	}

	var queue []pending
	for _, body := range bodies {
		attrs, diags := body.JustAttributes()
		e.diags.addHCL(diags)

		names := make([]string, 0, len(attrs))
		for name := range attrs {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			queue = append(queue, pending{name: name, expr: attrs[name].Expr})
		}
	}

	// The bound is captured before the loop on purpose. Using len(queue)
	// directly would tighten it on every pass as locals resolve, abandoning the
	// deepest dependency chains half-resolved and reporting determinable values
	// as unknown — the bug the spike for issue #1 found the hard way.
	maxPasses := len(queue) + 1
	resolved := map[string]cty.Value{}

	for pass := 0; pass < maxPasses && len(queue) > 0; pass++ {
		e.ctx.Variables["local"] = objectOrPlaceholder(resolved)

		var stillPending []pending
		progressed := false
		for _, item := range queue {
			value, diags := item.expr.Value(e.ctx)
			if diags.HasErrors() {
				stillPending = append(stillPending, item)
				continue
			}
			resolved[item.name] = value
			progressed = true
		}

		queue = stillPending
		if !progressed {
			break
		}
	}

	// Whatever never resolved is reported rather than silently dropped.
	for _, item := range queue {
		resolved[item.name] = cty.DynamicVal
		e.diags.add(model.Diagnostic{
			Severity: "warning",
			Code:     "unresolved-local",
			Message: fmt.Sprintf(
				"local.%s could not be determined: %s",
				item.name, e.explain(item.expr, "it depends on a value this analyzer cannot determine"),
			),
			Source: toRange(item.expr.Range()),
		})
	}

	e.ctx.Variables["local"] = objectOrPlaceholder(resolved)
}

// seedReferences makes every declared resource and data source referenceable.
//
// Without this, `aws_vpc.main.id` produces "there is no variable named
// aws_vpc", which is true of the evaluation context and useless to a learner.
// Seeding them as unknown yields the honest answer instead: the value exists,
// it simply is not determinable yet.
func (e *evaluator) seedReferences(p parsed) {
	resources := map[string]map[string]cty.Value{}
	for _, block := range p.resources {
		rType, rName := block.Labels[0], block.Labels[1]
		e.declaredResources[rType+"."+rName] = true
		if resources[rType] == nil {
			resources[rType] = map[string]cty.Value{}
		}
		resources[rType][rName] = cty.DynamicVal
	}
	for rType, byName := range resources {
		e.ctx.Variables[rType] = objectOrPlaceholder(byName)
	}

	dataByType := map[string]map[string]cty.Value{}
	for _, block := range p.data {
		dType, dName := block.Labels[0], block.Labels[1]
		e.declaredData[dType+"."+dName] = true
		if dataByType[dType] == nil {
			dataByType[dType] = map[string]cty.Value{}
		}
		dataByType[dType][dName] = cty.DynamicVal
	}
	if len(dataByType) > 0 {
		byType := map[string]cty.Value{}
		for dType, byName := range dataByType {
			byType[dType] = objectOrPlaceholder(byName)
		}
		e.ctx.Variables["data"] = objectOrPlaceholder(byType)
	}
}

// refreshResourceValues republishes what has been evaluated so far, so a
// resource referencing another resource's literal value can resolve it.
func (e *evaluator) refreshResourceValues(nodes []model.Node) {
	byType := map[string]map[string]cty.Value{}

	for _, node := range nodes {
		attrs := map[string]cty.Value{}
		for name, attribute := range node.Attributes {
			if !attribute.Known {
				continue
			}
			value, err := nativeToCty(attribute.Value)
			if err != nil {
				continue
			}
			attrs[name] = value
		}
		// Terraform computes these when it creates the infrastructure, so they
		// are knowable in principle and unknown in practice.
		for _, name := range computedAttributes {
			if _, taken := attrs[name]; !taken {
				attrs[name] = cty.DynamicVal
			}
		}

		parts := strings.SplitN(node.Address, ".", 2)
		if len(parts) != 2 {
			continue
		}
		if byType[parts[0]] == nil {
			byType[parts[0]] = map[string]cty.Value{}
		}
		byType[parts[0]][parts[1]] = cty.ObjectVal(attrs)
	}

	for rType, byName := range byType {
		e.ctx.Variables[rType] = objectOrPlaceholder(byName)
	}
}

// evaluateAttribute turns one attribute expression into a model attribute.
//
// Every failure path produces an unknown with a reason a learner can act on.
// There is no path that returns a guess.
func (e *evaluator) evaluateAttribute(expr hcl.Expression) model.Attribute {
	if name, reason, ok := e.unsupportedFunction(expr); ok {
		return model.Unknown(fmt.Sprintf("uses %s(), which this analyzer does not support: %s", name, reason))
	}

	value, diags := expr.Value(e.ctx)
	if diags.HasErrors() {
		return model.Unknown(e.explain(expr, firstDiagnostic(diags)))
	}
	if !value.IsWhollyKnown() {
		return model.Unknown(e.explain(expr, "it is not determinable without running Terraform"))
	}

	native, err := ctyToNative(value)
	if err != nil {
		return model.Unknown(err.Error())
	}
	return model.Known(native)
}

// explain turns a failure into something worth reading.
//
// "There is no variable named aws_subnet" describes our evaluation context.
// "depends on aws_subnet.public.id, which Terraform only determines when the
// infrastructure is created" describes the user's code, which is the only one
// of the two they can do anything about.
func (e *evaluator) explain(expr hcl.Expression, fallback string) string {
	for _, traversal := range expr.Variables() {
		address := traversalAddress(traversal)
		if address == "" {
			continue
		}

		switch {
		case strings.HasPrefix(address, "data."):
			return fmt.Sprintf(
				"it depends on %s, and data sources are read from the cloud provider, which needs credentials",
				trimToAddress(address, 3),
			)
		case strings.HasPrefix(address, "var."):
			name := trimToAddress(address, 2)
			if e.variablesNoValue[strings.TrimPrefix(name, "var.")] {
				return fmt.Sprintf("it depends on %s, which has no default value", name)
			}
		case strings.HasPrefix(address, "count.") || strings.HasPrefix(address, "each."):
			return "it depends on count or for_each, which this analyzer does not expand yet"
		default:
			short := trimToAddress(address, 2)
			if e.declaredResources[short] {
				return fmt.Sprintf(
					"it depends on %s, which Terraform only determines when the infrastructure is created",
					address,
				)
			}
		}
	}
	return fallback
}

// unsupportedFunction reports a call this analyzer knowingly does not
// implement, so the answer is "we do not do that" rather than a parser error.
func (e *evaluator) unsupportedFunction(expr hcl.Expression) (string, string, bool) {
	for _, name := range calledFunctions(expr) {
		if reason, unsupported := knownUnsupportedFunctions[name]; unsupported {
			return name, reason, true
		}
	}
	return "", "", false
}

func firstDiagnostic(diags hcl.Diagnostics) string {
	for _, d := range diags {
		if d.Detail != "" {
			return strings.TrimSuffix(d.Detail, ".")
		}
		return strings.TrimSuffix(d.Summary, ".")
	}
	return "it could not be evaluated"
}

// objectOrPlaceholder keeps cty.ObjectVal from panicking on an empty map.
// The placeholder key is unreachable from HCL because it is not a valid
// identifier, so it can never collide with something the user wrote.
func objectOrPlaceholder(values map[string]cty.Value) cty.Value {
	if len(values) == 0 {
		return cty.ObjectVal(map[string]cty.Value{"__none__": cty.StringVal("")})
	}
	return cty.ObjectVal(values)
}
