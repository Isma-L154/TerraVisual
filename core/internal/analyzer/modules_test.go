package analyzer

import (
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func TestLocalModuleResourcesAppear(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
module "network" {
  source = "./modules/network"

  cidr = "10.0.0.0/16"
}
`,
		"modules/network/main.tf": `
variable "cidr" {
  type = string
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr
}
`,
	})

	// Addresses carry the module path, which is what keeps two modules
	// declaring the same resource name distinguishable.
	vpc := node(t, result, "module.network.aws_vpc.this")

	if got := vpc.Attributes["cidr_block"]; !got.Known || got.Value != "10.0.0.0/16" {
		t.Errorf("the value the caller passed in did not reach the module: %+v", got)
	}
	if vpc.ModulePath != "network" {
		t.Errorf("modulePath = %q, want network", vpc.ModulePath)
	}
}

// Without splitting the workspace by directory, a module's files would also be
// read as the root module's and every resource would appear twice.
func TestModuleFilesAreNotAlsoRootFiles(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf":                 `module "network" { source = "./modules/network" }`,
		"modules/network/main.tf": `resource "aws_vpc" "this" {}`,
	})

	count := 0
	for _, n := range result.Nodes {
		if n.Type == "aws_vpc" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("the VPC appears %d times, want once", count)
	}
}

func TestModuleOutputsReachTheCaller(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
module "network" {
  source = "./modules/network"
}

resource "aws_instance" "web" {
  cidr_from_module = module.network.cidr
}
`,
		"modules/network/main.tf": `
resource "aws_vpc" "this" {
  cidr_block = "10.1.0.0/16"
}

output "cidr" {
  value = aws_vpc.this.cidr_block
}
`,
	})

	got := node(t, result, "aws_instance.web").Attributes["cidr_from_module"]
	if !got.Known {
		t.Fatalf("a module output should resolve in the caller: %s", got.Reason)
	}
	if got.Value != "10.1.0.0/16" {
		t.Errorf("cidr_from_module = %v", got.Value)
	}
}

func TestModuleDefaultsApplyWhenTheCallerSaysNothing(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `module "network" { source = "./modules/network" }`,
		"modules/network/main.tf": `
variable "cidr" {
  default = "172.16.0.0/12"
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr
}
`,
	})

	got := node(t, result, "module.network.aws_vpc.this").Attributes["cidr_block"]
	if !got.Known || got.Value != "172.16.0.0/12" {
		t.Errorf("cidr_block = %+v, want the module's own default", got)
	}
}

func TestNestedModules(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
module "outer" {
  source = "./modules/outer"
  name   = "from-root"
}
`,
		"modules/outer/main.tf": `
variable "name" {}

module "inner" {
  source = "./inner"
  name   = var.name
}
`,
		"modules/outer/inner/main.tf": `
variable "name" {}

resource "aws_s3_bucket" "this" {
  bucket = var.name
}
`,
	})

	bucket := node(t, result, "module.outer.inner.aws_s3_bucket.this")
	if got := bucket.Attributes["bucket"]; !got.Known || got.Value != "from-root" {
		t.Errorf("a value should pass through two levels of module: %+v", got)
	}
}

func TestSameModuleUsedTwice(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
module "a" {
  source = "./modules/bucket"
  name   = "first"
}

module "b" {
  source = "./modules/bucket"
  name   = "second"
}
`,
		"modules/bucket/main.tf": `
variable "name" {}

resource "aws_s3_bucket" "this" {
  bucket = var.name
}
`,
	})

	// The same module in two places describes two different pieces of
	// infrastructure. That is the entire point of a module being reusable.
	first := node(t, result, "module.a.aws_s3_bucket.this").Attributes["bucket"]
	second := node(t, result, "module.b.aws_s3_bucket.this").Attributes["bucket"]

	if first.Value != "first" || second.Value != "second" {
		t.Errorf("the two instances share a value: %v and %v", first.Value, second.Value)
	}
}

func TestModuleContentsAreGroupedInTheDiagram(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `module "network" { source = "./modules/network" }`,
		"modules/network/main.tf": `
resource "aws_vpc" "this" {}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.this.id
}
`,
	})

	nodes := nodesByAddress(result)

	container, present := nodes["module.network"]
	if !present {
		t.Fatal("a module should produce a container so its contents are visible as a group")
	}
	if !container.IsContainer {
		t.Error("the module node must be a container")
	}
	// Containment inside the module is preserved: the subnet still sits in its
	// VPC rather than being flattened into the module box.
	if got := nodes["module.network.aws_subnet.public"].ParentID; got != "module.network.aws_vpc.this" {
		t.Errorf("subnet parent = %q, want the VPC in the same module", got)
	}
	if got := nodes["module.network.aws_vpc.this"].ParentID; got != "module.network" {
		t.Errorf("the VPC should sit in its module box, got %q", got)
	}
}

// A module whose resources all belong to one provider sits inside that
// provider's frame. A mixed one has no single answer and stays at the top.
func TestModuleSitsInsideItsProviderFrame(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf":                 `module "network" { source = "./modules/network" }`,
		"modules/network/main.tf": `resource "aws_vpc" "this" {}`,
	})

	nodes := nodesByAddress(result)
	if got := nodes["module.network"].ParentID; got != "provider.aws" {
		t.Errorf("module parent = %q, want provider.aws", got)
	}
}

// Every one of these is a reason a module's resources cannot be shown. Silence
// would leave a user with an empty diagram and no explanation.
func TestUnresolvableModulesExplainThemselves(t *testing.T) {
	cases := map[string]struct {
		files map[string]string
		code  string
	}{
		"remote source": {
			files: map[string]string{
				"main.tf": `module "vpc" { source = "terraform-aws-modules/vpc/aws" }`,
			},
			code: "remote-module-not-supported",
		},
		"missing directory": {
			files: map[string]string{
				"main.tf": `module "vpc" { source = "./modules/nowhere" }`,
			},
			code: "module-not-found",
		},
		"escapes the workspace": {
			files: map[string]string{
				"main.tf": `module "vpc" { source = "../../../etc" }`,
			},
			code: "module-outside-workspace",
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			result := Analyze(tc.files)
			if !hasCode(result, tc.code) {
				t.Errorf("expected a %q diagnostic, got %v", tc.code, codesOf(result))
			}
		})
	}
}

// A module reaching itself would recurse until the tab died. The check exists
// because the cost of being wrong is unrecoverable, not because it is likely.
func TestModuleCycleIsBrokenAndReported(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf":        `module "a" { source = "./a" }`,
		"a/main.tf":      `module "b" { source = "../b" }`,
		"b/main.tf":      `module "a" { source = "../a" }`,
		"b/resources.tf": `resource "aws_vpc" "in_b" {}`,
	})

	if !hasCode(result, "module-cycle") {
		t.Errorf("expected a module-cycle diagnostic, got %v", codesOf(result))
	}
	// Everything reachable before the cycle is still analyzed.
	node(t, result, "module.a.b.aws_vpc.in_b")
}

func TestModulePathIsRecordedOnEveryNode(t *testing.T) {
	result := Analyze(map[string]string{
		"main.tf": `
resource "aws_vpc" "root" {}
module "network" { source = "./modules/network" }
`,
		"modules/network/main.tf": `resource "aws_subnet" "inner" {}`,
	})

	if got := node(t, result, "aws_vpc.root").ModulePath; got != "" {
		t.Errorf("a root resource should have no module path, got %q", got)
	}
	if got := node(t, result, "module.network.aws_subnet.inner").ModulePath; got != "network" {
		t.Errorf("modulePath = %q, want network", got)
	}
}

func codesOf(result model.Result) []string {
	var codes []string
	for _, d := range result.Diagnostics {
		codes = append(codes, d.Code)
	}
	return codes
}
