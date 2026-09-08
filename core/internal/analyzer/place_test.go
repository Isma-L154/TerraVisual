package analyzer

import (
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func nodesByAddress(result model.Result) map[string]model.Node {
	byAddress := map[string]model.Node{}
	for _, n := range result.Nodes {
		byAddress[n.Address] = n
	}
	return byAddress
}

// The containment the diagram draws is not in the Terraform: subnet_id is
// structurally the same as any other reference. These tests are where that
// decision gets checked.
func TestContainmentFollowsTheCatalog(t *testing.T) {
	result := analyzeSource(t, `
provider "aws" {
  region = "eu-west-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
}

resource "aws_instance" "web" {
  subnet_id = aws_subnet.public.id
}
`)

	nodes := nodesByAddress(result)

	want := map[string]string{
		"aws_instance.web":     "aws_subnet.public",
		"aws_subnet.public":    "aws_vpc.main",
		"aws_vpc.main":         "region.aws.eu-west-1",
		"region.aws.eu-west-1": "provider.aws",
		"provider.aws":         "",
	}
	for address, parent := range want {
		node, present := nodes[address]
		if !present {
			t.Errorf("expected a node at %s", address)
			continue
		}
		if node.ParentID != parent {
			t.Errorf("%s parent = %q, want %q", address, node.ParentID, parent)
		}
	}

	for address, node := range nodes {
		if node.Unplaced {
			t.Errorf("%s should be placed", address)
		}
	}
}

// Both rules are true for an EC2 instance sitting in a subnet inside a VPC.
// Priority is what makes the diagram show the useful one.
func TestMoreSpecificPlacementWins(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {}
resource "aws_subnet" "public" { vpc_id = aws_vpc.main.id }

resource "aws_lb_target_group" "web" {
  vpc_id = aws_vpc.main.id
}
`)

	nodes := nodesByAddress(result)
	if got := nodes["aws_lb_target_group.web"].ParentID; got != "aws_vpc.main" {
		t.Errorf("target group parent = %q, want aws_vpc.main", got)
	}
	if got := nodes["aws_subnet.public"].ParentID; got != "aws_vpc.main" {
		t.Errorf("subnet parent = %q, want aws_vpc.main", got)
	}
}

func TestCatalogSuppliesPresentation(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_instance" "web" {}
resource "aws_s3_bucket" "assets" {}
resource "aws_vpc" "main" {}
`)

	nodes := nodesByAddress(result)

	cases := map[string]struct {
		category    string
		isContainer bool
	}{
		"aws_instance.web":     {"compute", false},
		"aws_s3_bucket.assets": {"storage", false},
		"aws_vpc.main":         {"network", true},
	}
	for address, want := range cases {
		node := nodes[address]
		if !node.Catalogued {
			t.Errorf("%s should be catalogued", address)
		}
		if node.Category != want.category {
			t.Errorf("%s category = %q, want %q", address, node.Category, want.category)
		}
		if node.IsContainer != want.isContainer {
			t.Errorf("%s isContainer = %v, want %v", address, node.IsContainer, want.isContainer)
		}
	}
}

// A real project brings dozens of types nobody catalogued. The diagram must
// never look empty, and must never look complete when it is not.
func TestUncataloguedResourcesAreStillDrawn(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {}
resource "aws_wildly_new_service" "x" {}
resource "some_other_provider_thing" "y" {}
`)

	nodes := nodesByAddress(result)

	unknownAWS := nodes["aws_wildly_new_service.x"]
	if unknownAWS.Catalogued {
		t.Error("an uncatalogued type must be marked as such")
	}
	// It is still recognisably AWS, so it belongs in the AWS box rather than
	// floating outside the diagram.
	if unknownAWS.ParentID != "provider.aws" {
		t.Errorf("uncatalogued AWS resource parent = %q, want provider.aws", unknownAWS.ParentID)
	}

	foreign := nodes["some_other_provider_thing.y"]
	if !foreign.Unplaced {
		t.Error("a resource from no recognised provider has nowhere to go and should say so")
	}
	if foreign.Catalogued {
		t.Error("an unrecognised type must not be reported as catalogued")
	}
}

func TestNoProviderContainerWithoutResources(t *testing.T) {
	result := analyzeSource(t, `resource "some_other_provider_thing" "y" {}`)

	for _, node := range result.Nodes {
		if node.Type == "provider" {
			t.Errorf("an AWS-free workspace should not sprout a %s container", node.Label)
		}
	}
}

// The region comes from the provider block, and only when there is one
// unambiguous answer. Guessing would put resources in a region half of them
// are not in.
func TestRegionLayerOnlyWhenUnambiguous(t *testing.T) {
	t.Run("aliased providers", func(t *testing.T) {
		result := analyzeSource(t, `
provider "aws" { region = "eu-west-1" }
provider "aws" {
  alias  = "backup"
  region = "us-east-1"
}
resource "aws_vpc" "main" {}
`)
		for _, node := range result.Nodes {
			if node.Type == "region" {
				t.Errorf("region %q was inferred despite two provider blocks", node.Label)
			}
		}
		if !hasCode(result, "multiple-provider-blocks") {
			t.Error("giving up on the region layer must be explained, not silent")
		}
	})

	t.Run("undeterminable region", func(t *testing.T) {
		result := analyzeSource(t, `
variable "region" {}
provider "aws" { region = var.region }
resource "aws_vpc" "main" {}
`)
		for _, node := range result.Nodes {
			if node.Type == "region" {
				t.Error("a region built from a valueless variable is not determinable")
			}
		}
		if !hasCode(result, "region-not-determinable") {
			t.Error("expected an explanation for the missing region layer")
		}
	})

	t.Run("no provider block", func(t *testing.T) {
		result := analyzeSource(t, `resource "aws_vpc" "main" {}`)

		nodes := nodesByAddress(result)
		if nodes["aws_vpc.main"].ParentID != "provider.aws" {
			t.Errorf("without a region the VPC should sit directly in the provider container, got %q",
				nodes["aws_vpc.main"].ParentID)
		}
	})
}

// Containers are emitted before their children so a consumer can build the
// tree in one pass instead of looking ahead for a parent it has not seen.
func TestContainersComeFirst(t *testing.T) {
	result := analyzeSource(t, `
provider "aws" { region = "eu-west-1" }
resource "aws_vpc" "main" {}
resource "aws_subnet" "public" { vpc_id = aws_vpc.main.id }
`)

	seen := map[string]bool{}
	for _, node := range result.Nodes {
		if node.ParentID != "" && !seen[node.ParentID] {
			// Resource-to-resource containment is resolved after the fact, so
			// only the synthetic frame is required to come first.
			if node.ParentID == "provider.aws" || node.Type == "region" {
				t.Errorf("%s appears before its parent %s", node.Address, node.ParentID)
			}
		}
		seen[node.ID] = true
	}
}
