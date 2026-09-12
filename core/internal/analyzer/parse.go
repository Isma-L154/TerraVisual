package analyzer

import (
	"sort"
	"strconv"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclparse"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// The blocks this analyzer understands. PartialContent is used rather than
// Content so that unrecognised blocks are skipped instead of turned into
// errors: Terraform gains block types faster than we will, and a file using
// one should still produce a diagram for everything else.
var fileSchema = &hcl.BodySchema{
	Blocks: []hcl.BlockHeaderSchema{
		{Type: "variable", LabelNames: []string{"name"}},
		{Type: "locals"},
		{Type: "resource", LabelNames: []string{"type", "name"}},
		{Type: "data", LabelNames: []string{"type", "name"}},
		{Type: "module", LabelNames: []string{"name"}},
		{Type: "output", LabelNames: []string{"name"}},
		{Type: "provider", LabelNames: []string{"name"}},
	},
}

var variableSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "default"},
		{Name: "type"},
		{Name: "description"},
		{Name: "sensitive"},
		{Name: "nullable"},
	},
}

// parsed is everything the evaluator needs, gathered from every file before
// any evaluation happens.
type parsed struct {
	variables []*hcl.Block
	locals    []hcl.Body
	resources []*hcl.Block
	data      []*hcl.Block
	modules   []*hcl.Block
	providers []*hcl.Block
	outputs   []*hcl.Block
}

// parseWorkspace parses every file and collects the blocks it recognises.
//
// Files are parsed independently and a failure in one never stops the others.
// While the user is typing, most files are broken most of the time, so partial
// output is the normal case rather than the exceptional one.
func parseWorkspace(files map[string]string, diags *diagnostics) parsed {
	parser := hclparse.NewParser()

	// Sort for determinism: map iteration order would otherwise make node
	// ordering, and therefore layout, vary between identical runs.
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	var out parsed
	for _, name := range names {
		file, parseDiags := parser.ParseHCL([]byte(files[name]), name)
		diags.addHCL(parseDiags)
		if file == nil || file.Body == nil {
			continue
		}

		content, _, contentDiags := file.Body.PartialContent(fileSchema)
		diags.addHCL(contentDiags)
		if content == nil {
			continue
		}

		for _, block := range content.Blocks {
			switch block.Type {
			case "variable":
				out.variables = append(out.variables, block)
			case "locals":
				out.locals = append(out.locals, block.Body)
			case "resource":
				out.resources = append(out.resources, block)
			case "data":
				out.data = append(out.data, block)
			case "module":
				out.modules = append(out.modules, block)
			case "provider":
				out.providers = append(out.providers, block)
			case "output":
				out.outputs = append(out.outputs, block)
			}
		}
	}

	return out
}

// diagnostics accumulates messages without letting duplicates through.
//
// The same broken expression is often reached from several directions, and a
// list repeating one problem six times reads as six problems.
type diagnostics struct {
	items []model.Diagnostic
	seen  map[string]bool
}

func newDiagnostics() *diagnostics {
	return &diagnostics{seen: map[string]bool{}}
}

func (d *diagnostics) add(item model.Diagnostic) {
	key := item.Code + "|" + item.Message + "|" + item.Source.File +
		"|" + strconv.Itoa(item.Source.StartLine) + ":" + strconv.Itoa(item.Source.StartCol)
	if d.seen[key] {
		return
	}
	d.seen[key] = true
	d.items = append(d.items, item)
}

func (d *diagnostics) addHCL(from hcl.Diagnostics) {
	for _, item := range from {
		severity := "error"
		if item.Severity == hcl.DiagWarning {
			severity = "warning"
		}
		message := item.Summary
		if item.Detail != "" {
			message += ": " + item.Detail
		}
		var rng model.Range
		if item.Subject != nil {
			rng = toRange(*item.Subject)
		}
		d.add(model.Diagnostic{
			Severity: severity,
			Code:     "syntax-error",
			Message:  message,
			Source:   rng,
		})
	}
}

func (d *diagnostics) list() []model.Diagnostic {
	if d.items == nil {
		return []model.Diagnostic{}
	}
	return d.items
}

func toRange(r hcl.Range) model.Range {
	return model.Range{
		File:      r.Filename,
		StartLine: r.Start.Line,
		StartCol:  r.Start.Column,
		EndLine:   r.End.Line,
		EndCol:    r.End.Column,
	}
}
