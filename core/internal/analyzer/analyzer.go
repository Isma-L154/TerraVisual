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
	MaxNodes      = 20000
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

	p := parseWorkspace(files, diags)

	e := newEvaluator(diags)
	e.resolveVariables(p.variables)
	e.resolveLocals(p.locals)
	e.seedReferences(p)

	reportUnsupportedBlocks(p, diags)

	nodes, edges := evaluateResources(e, p, diags)

	result.Nodes = nodes
	result.Edges = edges
	result.Diagnostics = diags.list()
	result.Stats.Resources = len(nodes)
	result.Stats.Truncated = result.Stats.Truncated || len(nodes) >= MaxNodes || len(edges) >= MaxEdges
	result.Stats.DurationMs = int(time.Since(started).Milliseconds())

	return result
}

// evaluateResources runs the fixpoint over resource bodies.
//
// Later passes can resolve references to values another resource set
// literally. The number of passes is fixed rather than run to convergence,
// because "until nothing changes" on attacker-controlled input has no bound.
func evaluateResources(e *evaluator, p parsed, diags *diagnostics) ([]model.Node, []model.Edge) {
	var nodes []model.Node
	var edges []model.Edge

	for pass := 0; pass < resourceEvaluationPasses; pass++ {
		last := pass == resourceEvaluationPasses-1

		nodes = nil
		edges = nil
		for _, block := range p.resources {
			node, blockEdges := evaluateResource(e, block, last, diags)
			nodes = append(nodes, node)
			edges = append(edges, blockEdges...)

			if len(nodes) >= MaxNodes {
				diags.add(model.Diagnostic{
					Severity: "warning",
					Code:     "too-many-resources",
					Message: fmt.Sprintf(
						"This workspace declares more than %d resources. Only the first %d are shown.",
						MaxNodes, MaxNodes),
				})
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
	return nodes, edges
}

func evaluateResource(e *evaluator, block *hcl.Block, report bool, diags *diagnostics) (model.Node, []model.Edge) {
	rType, rName := block.Labels[0], block.Labels[1]
	address := rType + "." + rName

	node := model.Node{
		ID:       address,
		Address:  address,
		Type:     rType,
		Provider: providerFor(rType),
		// The catalog decides category, containment and iconography (#8).
		// Until it exists every resource is honestly uncatalogued rather than
		// guessed into a category.
		Category:   "other",
		Label:      rName,
		Catalogued: false,
		Unplaced:   true,
		Attributes: map[string]model.Attribute{},
		Source:     toRange(block.DefRange),
	}

	attrs, attrDiags := block.Body.JustAttributes()
	if report {
		diags.addHCL(attrDiags)
	}

	names := make([]string, 0, len(attrs))
	for name := range attrs {
		names = append(names, name)
	}
	sort.Strings(names)

	var edges []model.Edge
	for _, name := range names {
		attr := attrs[name]

		if name == "count" || name == "for_each" {
			if report {
				diags.add(model.Diagnostic{
					Severity: "info",
					Code:     "expansion-not-supported",
					Message: fmt.Sprintf(
						"%s uses %s. This analyzer does not expand it yet, so it is shown as a single resource.",
						address, name),
					Source: toRange(attr.Range),
				})
			}
			continue
		}

		node.Attributes[name] = e.evaluateAttribute(attr.Expr)

		for _, target := range referencedResources(attr.Expr, e.declaredResources) {
			if target == address {
				continue
			}
			edges = append(edges, model.Edge{
				ID:   address + "->" + target + "#" + name,
				From: address,
				To:   target,
				// Which references earn a *drawn* connection is an editorial
				// decision recorded in the catalog (#19). The model carries all
				// of them; the diagram shows the few that teach something.
				Kind:   "reference",
				Label:  name,
				Source: toRange(attr.Range),
			})
		}
	}

	return node, edges
}

// reportUnsupportedBlocks says plainly what the analyzer skipped.
//
// Silence here would be the worst outcome: a user whose whole infrastructure
// lives in modules would see an empty diagram and no explanation.
func reportUnsupportedBlocks(p parsed, diags *diagnostics) {
	for _, block := range p.modules {
		diags.add(model.Diagnostic{
			Severity: "info",
			Code:     "modules-not-supported",
			Message: fmt.Sprintf(
				"module %q is not analyzed yet, so the resources it declares are not shown.",
				block.Labels[0]),
			Source: toRange(block.DefRange),
		})
	}

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
