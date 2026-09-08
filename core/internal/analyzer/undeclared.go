package analyzer

import (
	"fmt"
	"strings"

	"github.com/hashicorp/hcl/v2"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Roots that are provided by Terraform rather than declared by the user.
// A reference through one of these is never "undeclared", whatever we can or
// cannot resolve about it.
var builtinRoots = map[string]bool{
	"count":     true,
	"each":      true,
	"self":      true,
	"path":      true,
	"terraform": true,
	"var":       true,
	"local":     true,
	"data":      true,
	"module":    true,
}

// reportUndeclared turns a reference to something that does not exist into an
// error, rather than leaving it as an unknown value.
//
// The distinction matters more here than it would elsewhere. These two look
// identical to an evaluator and are opposites to a learner:
//
//   - aws_vpc.main.id exists and is genuinely not knowable until Terraform
//     creates the infrastructure. Unknown is the correct, honest answer.
//   - var.nope does not exist at all. Nothing will ever make it resolve, and
//     calling it "unknown" tells somebody to wait for something that is never
//     coming.
//
// The bias throughout is against false accusations: anything this cannot be
// sure about stays an unknown.
func (e *evaluator) reportUndeclared(expr hcl.Expression, rng hcl.Range) {
	for _, traversal := range expr.Variables() {
		root, ok := traversal[0].(hcl.TraverseRoot)
		if !ok {
			continue
		}

		address := traversalAddress(traversal)

		switch root.Name {
		case "var":
			if name := second(traversal); name != "" && !e.declaredVariables[name] {
				e.reportMissing(rng, "input variable", "var."+name,
					"declare it with a variable block, or check the spelling")
			}
		case "local":
			if name := second(traversal); name != "" && !e.declaredLocals[name] {
				e.reportMissing(rng, "local value", "local."+name,
					"add it to a locals block, or check the spelling")
			}
		case "data":
			if name := trimToAddress(address, 3); strings.Count(name, ".") == 2 && !e.declaredData[strings.TrimPrefix(name, "data.")] {
				e.reportMissing(rng, "data source", name,
					"declare it with a data block, or check the spelling")
			}
		case "module":
			// A module that exists but could not be resolved has already been
			// reported by name, and blaming the user for referencing it would
			// be a second, wrong message about the same problem.
			if name := second(traversal); name != "" && !e.declaredModules[name] {
				e.reportMissing(rng, "module", "module."+name,
					"declare it with a module block, or check the spelling")
			}
		default:
			if builtinRoots[root.Name] {
				continue
			}
			// A resource reference is two segments: type and name. Anything
			// shorter is not one, and guessing would produce noise.
			short := trimToAddress(address, 2)
			if strings.Count(short, ".") != 1 || e.declaredResources[short] {
				continue
			}
			// Only complain when the type is one the workspace uses somewhere.
			// Otherwise a reference into a construct this analyzer does not
			// model yet would be reported as the user's mistake.
			if !e.declaredTypes[root.Name] {
				continue
			}
			e.reportMissing(rng, "resource", short,
				"declare it, or check the name against the resources you have")
		}
	}
}

func (e *evaluator) reportMissing(rng hcl.Range, kind, address, advice string) {
	e.diags.add(model.Diagnostic{
		Severity: "error",
		Code:     "undeclared-reference",
		Message: fmt.Sprintf(
			"There is no %s called %s. Terraform would refuse this configuration: %s.",
			kind, address, advice),
		Source: toRange(rng),
	})
}

// second returns the second segment of a traversal, which for var.foo and
// local.foo is the name.
func second(traversal hcl.Traversal) string {
	if len(traversal) < 2 {
		return ""
	}
	if attr, ok := traversal[1].(hcl.TraverseAttr); ok {
		return attr.Name
	}
	return ""
}
