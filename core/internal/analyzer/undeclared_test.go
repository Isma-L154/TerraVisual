package analyzer

import (
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func undeclaredMessages(result model.Result) []string {
	var out []string
	for _, d := range result.Diagnostics {
		if d.Code == "undeclared-reference" {
			out = append(out, d.Message)
		}
	}
	return out
}

// The distinction this whole file exists for: two situations that look
// identical to an evaluator and are opposites to a learner.
func TestUndeclaredReferencesAreErrors(t *testing.T) {
	cases := map[string]struct {
		source  string
		mention string
	}{
		"input variable": {
			source:  `resource "test_thing" "x" { value = var.nope }`,
			mention: "var.nope",
		},
		"local value": {
			source:  `resource "test_thing" "x" { value = local.nope }`,
			mention: "local.nope",
		},
		"data source": {
			source:  `resource "test_thing" "x" { value = data.aws_ami.nope.id }`,
			mention: "data.aws_ami.nope",
		},
		"module": {
			source:  `resource "test_thing" "x" { value = module.nope.out }`,
			mention: "module.nope",
		},
		"resource": {
			source: `
resource "aws_vpc" "main" {}
resource "aws_subnet" "s" { vpc_id = aws_vpc.typo.id }
`,
			mention: "aws_vpc.typo",
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			result := analyzeSource(t, tc.source)

			messages := undeclaredMessages(result)
			if len(messages) == 0 {
				t.Fatalf("expected an undeclared-reference error, got %v", codesOf(result))
			}

			found := false
			for _, message := range messages {
				if strings.Contains(message, tc.mention) {
					found = true
				}
			}
			if !found {
				t.Errorf("the error should name %s, got %v", tc.mention, messages)
			}
		})
	}
}

// The risk in this change is over-reporting, not under-reporting. Every case
// below is a value that genuinely cannot be determined yet, and calling any of
// them an error would accuse the user of a mistake they did not make.
func TestDeterminableAbsencesAreNotErrors(t *testing.T) {
	cases := map[string]string{
		"a computed attribute": `
resource "aws_vpc" "main" {}
resource "aws_subnet" "s" { vpc_id = aws_vpc.main.id }
`,
		"a declared data source": `
data "aws_ami" "ubuntu" {}
resource "test_thing" "x" { value = data.aws_ami.ubuntu.id }
`,
		"a variable with no default": `
variable "email" {}
resource "test_thing" "x" { value = var.email }
`,
		"count and each": `
resource "test_thing" "x" {
  count = 2
  value = count.index
}
`,
		"path and terraform": `
resource "test_thing" "x" {
  here  = path.module
  space = terraform.workspace
}
`,
		"a resource type this workspace does not use at all": `
resource "test_thing" "x" { value = some_unmodelled_construct.thing.id }
`,
	}

	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			result := analyzeSource(t, source)

			if messages := undeclaredMessages(result); len(messages) > 0 {
				t.Errorf("nothing here is undeclared, but got: %v", messages)
			}
		})
	}
}

// A module that exists but could not be resolved has already been reported by
// name. Blaming the user for referencing it would be a second, wrong message
// about the same problem.
func TestReferencingAnUnresolvableModuleIsNotTheUsersMistake(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
}

resource "test_thing" "x" {
  value = module.vpc.vpc_id
}
`,
	})

	if messages := undeclaredMessages(result); len(messages) > 0 {
		t.Errorf("the module is declared; only its source is unreachable: %v", messages)
	}
	if !hasCode(result, "remote-module-not-supported") {
		t.Error("the real problem should still be reported")
	}
}

// The value stays unknown either way: the model has to remain well formed so
// the diagram still renders around the mistake.
func TestAnUndeclaredReferenceStillLeavesAUsableModel(t *testing.T) {
	result := analyzeSource(t, `
resource "test_thing" "x" {
  broken = var.nope
  fine   = "still here"
}
`)

	thing := node(t, result, "test_thing.x")
	if got := thing.Attributes["broken"]; got.Known {
		t.Error("an undeclared reference cannot produce a value")
	}
	if got := thing.Attributes["fine"]; !got.Known || got.Value != "still here" {
		t.Errorf("one bad reference must not poison its neighbours: %+v", got)
	}
}

func TestUndeclaredReferencesCarryTheirPosition(t *testing.T) {
	result := analyzeSource(t, "resource \"test_thing\" \"x\" {\n  value = var.nope\n}\n")

	for _, d := range result.Diagnostics {
		if d.Code != "undeclared-reference" {
			continue
		}
		if d.Source.File != "main.tf" || d.Source.StartLine != 2 {
			t.Errorf("position = %+v, want main.tf line 2", d.Source)
		}
		return
	}
	t.Fatal("no undeclared-reference diagnostic")
}
