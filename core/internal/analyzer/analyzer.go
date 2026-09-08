// Package analyzer turns a workspace of Terraform files into an InfraModel.
//
// Everything here assumes its input is hostile. There is no server between the
// user and this code (ADR-0001), so this is the trust boundary: it enforces the
// limits, it never panics out, and when it cannot determine something it says
// so rather than guessing.
package analyzer

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Limits on what the analyzer will accept or produce.
//
// These are security control 3 in practice: with no server, the browser tab is
// what an attacker — or an accident — can exhaust. They are deliberately
// generous for real projects and firmly finite.
const (
	MaxFiles      = 1000
	MaxTotalBytes = 8 << 20 // 8 MiB of source
	MaxFileBytes  = 2 << 20 // 2 MiB in any single file
	MaxEdges      = 50000
)

// Analyze is the single entry point.
//
// It always returns a well-formed result. Malformed input produces
// diagnostics, and a panic anywhere inside becomes a diagnostic too, because
// this runs behind a WASM boundary where an uncaught panic takes down the
// module for the rest of the session.
func Analyze(files map[string]string) model.Result {
	return recovered(func() model.Result {
		return analyze(files)
	})
}

func analyze(files map[string]string) model.Result {
	started := time.Now()

	result := model.Empty()
	diags := newDiagnostics()

	files, limitDiags := enforceLimits(files)
	for _, d := range limitDiags {
		diags.add(d)
	}
	result.Stats.Files = len(files)

	tree := buildModuleTree(files, diags)

	nodes, edges, references, containers := analyzeModule(tree, nil, diags)

	// Counted before the synthetic frame is added: a workspace with three
	// resources has three resources, however many boxes are drawn around them.
	declared := len(nodes)

	nodes = append(containers, nodes...)
	nodes = applyCatalog(nodes, placement{
		references: references,
		regions:    tree.regions,
		modules:    moduleMembership(nodes),
	}, diags)

	if nodes == nil {
		nodes = []model.Node{}
	}
	if edges == nil {
		edges = []model.Edge{}
	}

	result.Nodes = nodes
	result.Edges = edges
	result.Diagnostics = diags.list()
	result.Stats.Resources = declared
	result.Stats.Truncated = result.Stats.Truncated ||
		len(nodes) >= MaxTotalInstances ||
		len(edges) >= MaxEdges ||
		hasTruncatedExpansion(nodes)
	result.Stats.DurationMs = int(time.Since(started).Milliseconds())

	return result
}

// analyzeModule evaluates one module and everything it calls.
//
// Children are evaluated first, because a caller can only resolve
// `module.x.something` once x has produced its outputs. That ordering is the
// whole reason this is a tree walk rather than a flat pass.
func analyzeModule(m *moduleTree, callerCtx *hcl.EvalContext, diags *diagnostics) (
	[]model.Node, []model.Edge, map[string]map[string][]string, []model.Node,
) {
	// Inputs are evaluated in the *caller's* scope: `subnet_ids = local.ids`
	// in a module block means the caller's locals, not the module's.
	if m.inputBlock != nil && callerCtx != nil {
		m.inputs = evaluateModuleInputs(m.inputBlock, callerCtx, diags)
	}

	e := newEvaluator(diags)
	e.resolveVariables(m.parsed.variables, m.inputs)
	e.resolveLocals(m.parsed.locals)

	var nodes []model.Node
	var edges []model.Edge
	var containers []model.Node
	references := map[string]map[string][]string{}

	outputs := map[string]cty.Value{}
	for _, child := range m.children {
		childNodes, childEdges, childRefs, childContainers := analyzeModule(child, e.ctx, diags)
		nodes = append(nodes, childNodes...)
		edges = append(edges, childEdges...)
		containers = append(containers, childContainers...)
		for address, refs := range childRefs {
			references[address] = refs
		}
		outputs[lastModuleSegment(child.path)] = child.outputs
	}
	if len(outputs) > 0 {
		e.ctx.Variables["module"] = objectOrPlaceholder(outputs)
	}

	e.seedReferences(m.parsed)
	reportUnsupportedBlocks(m.parsed, diags)

	// Only the root module's provider configuration decides the region layer.
	// A nested module inherits its caller's providers, so reading its own
	// provider blocks would describe a configuration Terraform does not use.
	if m.path == "" {
		m.regions = detectRegions(e, m.parsed, diags)
	}

	moduleNodes, moduleEdges, moduleRefs := evaluateResources(e, m.parsed, diags)

	// Addresses carry the module path, so two modules declaring the same
	// resource name stay distinguishable -- which is the entire point of
	// modules being reusable.
	for i := range moduleNodes {
		moduleNodes[i].Address = qualify(m.path, moduleNodes[i].Address)
		moduleNodes[i].ID = moduleNodes[i].Address
		moduleNodes[i].ModulePath = m.path
	}
	for i := range moduleEdges {
		moduleEdges[i].From = qualify(m.path, moduleEdges[i].From)
		moduleEdges[i].To = qualify(m.path, moduleEdges[i].To)
		moduleEdges[i].ID = moduleEdges[i].From + "->" + moduleEdges[i].To + "#" + moduleEdges[i].Label
	}
	for address, refs := range moduleRefs {
		qualified := map[string][]string{}
		for attribute, targets := range refs {
			for _, target := range targets {
				qualified[attribute] = append(qualified[attribute], qualify(m.path, target))
			}
		}
		references[qualify(m.path, address)] = qualified
	}

	nodes = append(nodes, moduleNodes...)
	edges = append(edges, moduleEdges...)

	// Outputs are read after the module's own resources exist, so an output
	// referring to one of them resolves.
	e.refreshResourceValues(moduleNodes)
	m.outputs = moduleOutputs(e, m.parsed.outputs, diags)

	if m.path != "" {
		containers = append(containers, model.Node{
			ID:          "module." + m.path,
			Address:     "module." + m.path,
			Type:        "module",
			Provider:    "",
			Category:    "module",
			Label:       lastModuleSegment(m.path),
			IsContainer: true,
			Catalogued:  true,
			ModulePath:  parentModulePath(m.path),
			Attributes:  map[string]model.Attribute{},
			Source:      m.call,
		})
	}

	return nodes, edges, references, containers
}

// evaluateModuleInputs reads the values a module block passes in.
func evaluateModuleInputs(block *hcl.Block, ctx *hcl.EvalContext, diags *diagnostics) map[string]cty.Value {
	inputs := map[string]cty.Value{}

	attrs, attrDiags := block.Body.JustAttributes()
	diags.addHCL(attrDiags)

	names := make([]string, 0, len(attrs))
	for name := range attrs {
		switch name {
		case "source", "version", "providers", "count", "for_each", "depends_on":
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		value, valueDiags := attrs[name].Expr.Value(ctx)
		if valueDiags.HasErrors() {
			// An input the caller cannot determine is unknown inside the
			// module too, which is truthful rather than an error.
			inputs[name] = cty.DynamicVal
			continue
		}
		inputs[name] = value
	}

	return inputs
}

// moduleMembership maps each node to the module it was declared in, so
// containment can keep a module's contents together.
func moduleMembership(nodes []model.Node) map[string]string {
	membership := make(map[string]string, len(nodes))
	for _, node := range nodes {
		membership[node.ID] = node.ModulePath
	}
	return membership
}

func lastModuleSegment(modulePath string) string {
	if index := strings.LastIndexByte(modulePath, '.'); index >= 0 {
		return modulePath[index+1:]
	}
	return modulePath
}

func parentModulePath(modulePath string) string {
	if index := strings.LastIndexByte(modulePath, '.'); index >= 0 {
		return modulePath[:index]
	}
	return ""
}

// evaluateResources runs the fixpoint over resource bodies.
//
// Later passes can resolve references to values another resource set
// literally. The number of passes is fixed rather than run to convergence,
// because "until nothing changes" on attacker-controlled input has no bound.
func evaluateResources(e *evaluator, p parsed, diags *diagnostics) ([]model.Node, []model.Edge, map[string]map[string][]string) {
	var nodes []model.Node
	var edges []model.Edge
	references := map[string]map[string][]string{}

	for pass := 0; pass < resourceEvaluationPasses; pass++ {
		last := pass == resourceEvaluationPasses-1

		nodes = nil
		edges = nil
		references = map[string]map[string][]string{}

		for _, block := range p.resources {
			blockNodes, blockEdges, blockRefs := evaluateResource(e, block, last, diags)
			nodes = append(nodes, blockNodes...)
			edges = append(edges, blockEdges...)
			for address, refs := range blockRefs {
				references[address] = refs
			}

			if len(nodes) >= MaxTotalInstances {
				if last {
					diags.add(model.Diagnostic{
						Severity: "warning",
						Code:     "too-many-resources",
						Message: fmt.Sprintf(
							"This workspace produces more than %d resource instances. The rest are not shown.",
							MaxTotalInstances),
					})
				}
				break
			}
		}

		if !last {
			e.refreshResourceValues(nodes)
		}
	}

	if nodes == nil {
		nodes = []model.Node{}
	}
	if edges == nil {
		edges = []model.Edge{}
	}
	if len(edges) > MaxEdges {
		edges = edges[:MaxEdges]
	}
	return nodes, edges, references
}

// evaluateResource turns one resource block into however many instances it
// declares.
//
// Each instance is evaluated in its own child scope, so count.index and
// each.key resolve to that instance's values rather than to the block's.
func evaluateResource(e *evaluator, block *hcl.Block, report bool, diags *diagnostics) ([]model.Node, []model.Edge, map[string]map[string][]string) {
	rType, rName := block.Labels[0], block.Labels[1]
	base := rType + "." + rName

	attrs, attrDiags := block.Body.JustAttributes()
	if report {
		diags.addHCL(attrDiags)
	}

	names := make([]string, 0, len(attrs))
	for name := range attrs {
		if name == "count" || name == "for_each" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	instances := expandBlock(e, block, attrs, base, report, diags)

	nodes := make([]model.Node, 0, len(instances))
	var edges []model.Edge
	references := map[string]map[string][]string{}

	for _, item := range instances {
		address := base + item.suffix

		scope := e.ctx.NewChild()
		scope.Variables = item.scope

		node := model.Node{
			ID:       address,
			Address:  address,
			Type:     rType,
			Provider: providerFor(rType),
			// The catalog supplies category and containment later; until then
			// a resource is honestly uncatalogued rather than guessed into a
			// category.
			Category:   "other",
			Label:      rName,
			Catalogued: false,
			Unplaced:   true,
			Attributes: map[string]model.Attribute{},
			Expansion:  item.expansion,
			Source:     toRange(block.DefRange),
		}

		instanceRefs := map[string][]string{}
		for _, name := range names {
			attr := attrs[name]
			node.Attributes[name] = e.evaluateAttributeIn(scope, attr.Expr)

			for _, target := range referencedResources(attr.Expr, e.declaredResources) {
				if target == base {
					continue
				}
				instanceRefs[name] = append(instanceRefs[name], target)
				edges = append(edges, model.Edge{
					ID:   address + "->" + target + "#" + name,
					From: address,
					To:   target,
					// Which references earn a *drawn* connection is an
					// editorial decision recorded in the catalog (#19). The
					// model carries all of them so that decision has something
					// to work from.
					Kind:   "reference",
					Label:  name,
					Source: toRange(attr.Range),
				})
			}
		}

		references[address] = instanceRefs
		nodes = append(nodes, node)
	}

	return nodes, edges, references
}

// reportUnsupportedBlocks says plainly what the analyzer skipped.
//
// Silence here would be the worst outcome: a user whose infrastructure depends
// on something we cannot resolve would see an incomplete diagram and no
// explanation for it.
//
// Modules are not listed here any more. They are resolved now, and the reasons
// a particular one cannot be are reported where that is decided, naming the
// actual obstacle rather than the category.
func reportUnsupportedBlocks(p parsed, diags *diagnostics) {
	for _, block := range p.data {
		diags.add(model.Diagnostic{
			Severity: "info",
			Code:     "data-source-not-resolved",
			Message: fmt.Sprintf(
				"data.%s.%s is read from the cloud provider, which needs credentials, so anything depending on it is shown as unknown.",
				block.Labels[0], block.Labels[1]),
			Source: toRange(block.DefRange),
		})
	}
}

// enforceLimits drops what exceeds the caps and says which, rather than
// silently truncating. A partial analysis presented as a complete one is the
// failure mode this project cares most about avoiding.
func enforceLimits(files map[string]string) (map[string]string, []model.Diagnostic) {
	var reported []model.Diagnostic

	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	accepted := make(map[string]string, len(files))
	total := 0

	for _, name := range names {
		content := files[name]

		if len(accepted) >= MaxFiles {
			reported = append(reported, model.Diagnostic{
				Severity: "warning",
				Code:     "too-many-files",
				Message: fmt.Sprintf(
					"This workspace has more than %d files. The rest were not analyzed.", MaxFiles),
			})
			break
		}
		if len(content) > MaxFileBytes {
			reported = append(reported, model.Diagnostic{
				Severity: "warning",
				Code:     "file-too-large",
				Message: fmt.Sprintf(
					"%s is larger than %d MiB and was not analyzed.", name, MaxFileBytes>>20),
				Source: model.Range{File: name},
			})
			continue
		}
		if total+len(content) > MaxTotalBytes {
			reported = append(reported, model.Diagnostic{
				Severity: "warning",
				Code:     "workspace-too-large",
				Message: fmt.Sprintf(
					"This workspace is larger than %d MiB. Analysis stopped at %s.",
					MaxTotalBytes>>20, name),
				Source: model.Range{File: name},
			})
			break
		}

		accepted[name] = content
		total += len(content)
	}

	return accepted, reported
}

// hasTruncatedExpansion reports whether any resource produced fewer instances
// than it declares. The interface has to be able to say the picture is partial
// rather than presenting it as complete.
func hasTruncatedExpansion(nodes []model.Node) bool {
	for _, node := range nodes {
		if node.Expansion != nil && node.Expansion.Truncated {
			return true
		}
	}
	return false
}

// providerFor derives the provider from the resource type prefix.
//
// It is a naming convention rather than a guarantee, so anything unrecognised
// becomes "unknown" instead of a guess. The catalog (#8) will make this
// authoritative for the types it covers.
func providerFor(resourceType string) string {
	switch {
	case strings.HasPrefix(resourceType, "aws_"):
		return "aws"
	case strings.HasPrefix(resourceType, "azurerm_"), strings.HasPrefix(resourceType, "azuread_"):
		return "azure"
	case strings.HasPrefix(resourceType, "google_"):
		return "gcp"
	case strings.HasPrefix(resourceType, "kubernetes_"):
		return "kubernetes"
	default:
		return "unknown"
	}
}

// recovered turns a panic into a diagnostic.
//
// The spike for issue #1 found that a panic crossing the WASM boundary takes
// the whole module down, after which every later keystroke fails too.
// Recovering keeps the session alive and tells the user something went wrong,
// which is the difference between a bug and an outage.
func recovered(fn func() model.Result) (result model.Result) {
	defer func() {
		if r := recover(); r != nil {
			result = model.Empty()
			result.Diagnostics = append(result.Diagnostics, model.Diagnostic{
				Severity: "error",
				Code:     "analyzer-panic",
				Message:  fmt.Sprintf("The analyzer failed unexpectedly: %v", r),
			})
		}
	}()
	return fn()
}
