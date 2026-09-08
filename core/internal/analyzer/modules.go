package analyzer

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Limits on module resolution.
//
// Depth is bounded because a module tree comes from user input, and a cycle
// that slipped past the detector would otherwise recurse until the tab died.
// The count is bounded for the same reason a resource count is.
const (
	MaxModuleDepth = 10
	MaxModules     = 200
)

var moduleSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "source", Required: true},
		{Name: "version"},
		{Name: "providers"},
		{Name: "count"},
		{Name: "for_each"},
		{Name: "depends_on"},
	},
}

var outputSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "value", Required: true},
		{Name: "description"},
		{Name: "sensitive"},
	},
}

// moduleTree is one module and the modules it calls.
//
// The root module is the workspace directory; every other node is a `module`
// block whose source pointed at a directory in the same workspace.
type moduleTree struct {
	// path is the address prefix: "" at the root, "network" one level down,
	// "network.subnet" two.
	path string
	// dir is where its files live in the workspace.
	dir string
	// call is where the module block was written, so a diagnostic about the
	// module can point at the line that created it.
	call model.Range
	// inputs are the values the caller passed in.
	inputs map[string]cty.Value
	// inputBlock is the module block itself, kept so its attributes can be
	// evaluated later, in the caller's scope, once the caller's variables and
	// locals exist.
	inputBlock *hcl.Block
	parsed     parsed
	children   []*moduleTree
	// outputs is what the caller can see of this module, filled in once its
	// own resources have been evaluated.
	outputs cty.Value
	// regions is set on the root module only: a nested module inherits its
	// caller's providers, so its own provider blocks describe a configuration
	// Terraform does not use.
	regions map[string]string
}

// buildModuleTree resolves the workspace into a tree of modules.
//
// Only local sources are followed. A registry or git source would need a
// network fetch, which this product does not do (ADR-0001) -- so it is
// reported by name rather than silently producing an empty box.
func buildModuleTree(files map[string]string, diags *diagnostics) *moduleTree {
	byDir := groupByDirectory(files)

	root := &moduleTree{path: "", dir: "", parsed: parseWorkspace(byDir[""], diags)}

	// Cycle detection walks the chain of directories rather than the whole
	// visited set: a module used twice from different places is fine, a module
	// that reaches itself is not.
	resolveChildren(root, byDir, map[string]bool{"": true}, diags, &[]int{0}[0])
	return root
}

func resolveChildren(parent *moduleTree, byDir map[string]map[string]string, chain map[string]bool, diags *diagnostics, count *int) {
	depth := strings.Count(parent.path, ".") + 1
	if parent.path == "" {
		depth = 0
	}
	if depth >= MaxModuleDepth {
		if len(parent.parsed.modules) > 0 {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "module-depth-exceeded",
				Message: fmt.Sprintf(
					"Modules are nested more than %d deep. The deeper ones are not analyzed.",
					MaxModuleDepth),
				Source: parent.call,
			})
		}
		return
	}

	blocks := append([]*hcl.Block(nil), parent.parsed.modules...)
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].Labels[0] < blocks[j].Labels[0] })

	for _, block := range blocks {
		name := block.Labels[0]
		callRange := toRange(block.DefRange)

		content, _, contentDiags := block.Body.PartialContent(moduleSchema)
		diags.addHCL(contentDiags)
		if content == nil {
			continue
		}

		sourceAttr, ok := content.Attributes["source"]
		if !ok {
			continue
		}
		source, sourceDiags := sourceAttr.Expr.Value(nil)
		if sourceDiags.HasErrors() || !source.IsKnown() || source.IsNull() || source.Type() != cty.String {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "module-source-not-determinable",
				Message: fmt.Sprintf(
					"The source of module %q could not be read, so its resources are not shown.", name),
				Source: toRange(sourceAttr.Range),
			})
			continue
		}

		raw := source.AsString()
		if !isLocalSource(raw) {
			diags.add(model.Diagnostic{
				Severity: "info",
				Code:     "remote-module-not-supported",
				Message: fmt.Sprintf(
					"Module %q comes from %q. Remote modules are not downloaded here, so its resources are not shown.",
					name, raw),
				Source: toRange(sourceAttr.Range),
			})
			continue
		}

		// Resolution is confined to the workspace by construction. A source of
		// "../../../etc" cannot escape, because the result is normalised and
		// then only ever used as a key into the workspace map.
		dir, ok := resolveModuleDir(parent.dir, raw)
		if !ok {
			diags.add(model.Diagnostic{
				Severity: "error",
				Code:     "module-outside-workspace",
				Message: fmt.Sprintf(
					"Module %q points outside the workspace (%s), which cannot be read.", name, raw),
				Source: toRange(sourceAttr.Range),
			})
			continue
		}

		if chain[dir] {
			diags.add(model.Diagnostic{
				Severity: "error",
				Code:     "module-cycle",
				Message: fmt.Sprintf(
					"Module %q eventually calls itself, so it is not analyzed.", name),
				Source: callRange,
			})
			continue
		}

		moduleFiles, exists := byDir[dir]
		if !exists || len(moduleFiles) == 0 {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "module-not-found",
				Message: fmt.Sprintf(
					"Module %q points at %q, which has no Terraform files in this workspace.", name, raw),
				Source: toRange(sourceAttr.Range),
			})
			continue
		}

		if *count >= MaxModules {
			diags.add(model.Diagnostic{
				Severity: "warning",
				Code:     "too-many-modules",
				Message: fmt.Sprintf(
					"This workspace calls more than %d modules. The rest are not analyzed.", MaxModules),
				Source: callRange,
			})
			return
		}
		*count++

		child := &moduleTree{
			path:   joinModulePath(parent.path, name),
			dir:    dir,
			call:   callRange,
			parsed: parseWorkspace(moduleFiles, diags),
			inputs: map[string]cty.Value{},
		}
		// The block's own attributes, minus the meta ones, are the inputs. They
		// are evaluated later, in the caller's scope, once the caller's
		// variables and locals exist.
		child.inputBlock = block
		parent.children = append(parent.children, child)

		nested := make(map[string]bool, len(chain)+1)
		for key := range chain {
			nested[key] = true
		}
		nested[dir] = true
		resolveChildren(child, byDir, nested, diags, count)
	}
}

// groupByDirectory splits the workspace so each module sees only its own files.
//
// Without this, a module's resources would also be read as the root module's,
// and every resource in the workspace would appear twice.
func groupByDirectory(files map[string]string) map[string]map[string]string {
	byDir := map[string]map[string]string{}

	for name, content := range files {
		dir := path.Dir(name)
		if dir == "." {
			dir = ""
		}
		if byDir[dir] == nil {
			byDir[dir] = map[string]string{}
		}
		byDir[dir][name] = content
	}

	if byDir[""] == nil {
		byDir[""] = map[string]string{}
	}
	return byDir
}

// isLocalSource reports whether a module source refers to this workspace.
//
// Terraform treats a source starting with ./ or ../ as a local path and
// everything else as something to download.
func isLocalSource(source string) bool {
	return strings.HasPrefix(source, "./") || strings.HasPrefix(source, "../")
}

// resolveModuleDir resolves a local source against the calling module's
// directory, refusing anything that climbs out of the workspace.
func resolveModuleDir(from string, source string) (string, bool) {
	joined := path.Join(from, source)
	cleaned := path.Clean(joined)

	if cleaned == "." {
		return "", true
	}
	// path.Clean leaves a leading ".." when the path escapes, which is the one
	// case that must never resolve.
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
		return "", false
	}
	return cleaned, true
}

func joinModulePath(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "." + name
}

// qualify prefixes an address with its module path, so two modules declaring
// the same resource name stay distinguishable.
func qualify(modulePath, address string) string {
	if modulePath == "" {
		return address
	}
	return "module." + modulePath + "." + address
}

// moduleOutputs evaluates a module's output blocks, which is what the caller
// can see of it.
func moduleOutputs(e *evaluator, blocks []*hcl.Block, diags *diagnostics) cty.Value {
	values := map[string]cty.Value{}

	names := make([]string, 0, len(blocks))
	byName := map[string]*hcl.Block{}
	for _, block := range blocks {
		names = append(names, block.Labels[0])
		byName[block.Labels[0]] = block
	}
	sort.Strings(names)

	for _, name := range names {
		content, _, contentDiags := byName[name].Body.PartialContent(outputSchema)
		diags.addHCL(contentDiags)
		if content == nil {
			continue
		}
		attr, ok := content.Attributes["value"]
		if !ok {
			continue
		}

		value, valueDiags := attr.Expr.Value(e.ctx)
		if valueDiags.HasErrors() {
			// An output the module itself cannot determine is unknown to the
			// caller too, which is the truthful answer rather than an error.
			values[name] = cty.DynamicVal
			continue
		}
		values[name] = value
	}

	return objectOrPlaceholder(values)
}
