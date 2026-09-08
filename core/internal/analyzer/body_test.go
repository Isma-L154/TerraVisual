package analyzer

import (
	"sort"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Most real Terraform resources contain nested blocks: ingress, egress,
// ip_configuration, root_block_device, lifecycle. Reporting each one as
// "Blocks are not allowed here" filled a real project's diagram with problems
// it did not have.
func TestNestedBlocksAreNotSyntaxErrors(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_security_group" "web" {
  name = "web"

  ingress {
    from_port = 443
    to_port   = 443
  }

  egress {
    from_port = 0
    to_port   = 0
  }
}
`)

	for _, d := range result.Diagnostics {
		if d.Severity == "error" {
			t.Errorf("nested blocks produced an error: %s", d.Message)
		}
	}
	node(t, result, "aws_security_group.web")
}

// Nested attributes are addressed by path, which is what lets the catalog
// reach inside: Azure's containment lives in ip_configuration.subnet_id, not
// at the top level.
func TestNestedAttributesAreAddressedByPath(t *testing.T) {
	result := analyzeSource(t, `
resource "azurerm_network_interface" "nic" {
  name = "nic"

  ip_configuration {
    name                          = "internal"
    private_ip_address_allocation = "Dynamic"
  }
}
`)

	nic := node(t, result, "azurerm_network_interface.nic")

	got, present := nic.Attributes["ip_configuration.name"]
	if !present {
		t.Fatalf("expected a nested attribute path, got %v", keysOf(nic.Attributes))
	}
	if !got.Known || got.Value != "internal" {
		t.Errorf("ip_configuration.name = %+v", got)
	}
}

// Two blocks of the same type must stay distinguishable rather than one
// silently overwriting the other.
func TestRepeatedBlocksAreNumbered(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_security_group" "web" {
  ingress {
    from_port = 80
  }

  ingress {
    from_port = 443
  }
}
`)

	sg := node(t, result, "aws_security_group.web")

	first := sg.Attributes["ingress[0].from_port"]
	second := sg.Attributes["ingress[1].from_port"]

	if !first.Known || first.Value != float64(80) {
		t.Errorf("ingress[0].from_port = %+v", first)
	}
	if !second.Known || second.Value != float64(443) {
		t.Errorf("ingress[1].from_port = %+v", second)
	}
}

// A reference written inside a nested block is still a reference. Missing them
// would lose exactly the ones that matter for containment.
func TestReferencesInsideNestedBlocksAreDetected(t *testing.T) {
	result := analyzeSource(t, `
resource "azurerm_subnet" "internal" {}

resource "azurerm_network_interface" "nic" {
  ip_configuration {
    subnet_id = azurerm_subnet.internal.id
  }
}
`)

	found := false
	for _, edge := range result.Edges {
		if edge.From == "azurerm_network_interface.nic" &&
			edge.To == "azurerm_subnet.internal" &&
			edge.Label == "ip_configuration.subnet_id" {
			found = true
		}
	}
	if !found {
		t.Errorf("no edge for the nested reference; edges were %v", edgeLabels(result))
	}
}

func TestDeeplyNestedBlocksAreBounded(t *testing.T) {
	source := `resource "test_thing" "x" {` + "\n"
	for i := 0; i < 20; i++ {
		source += "  level {\n"
	}
	source += "    value = 1\n"
	for i := 0; i < 20; i++ {
		source += "  }\n"
	}
	source += "}\n"

	// The point is that it terminates and stays well formed, not what it finds.
	result := analyzeSource(t, source)
	node(t, result, "test_thing.x")
}

func keysOf(attributes map[string]model.Attribute) []string {
	names := make([]string, 0, len(attributes))
	for name := range attributes {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func edgeLabels(result model.Result) []string {
	var labels []string
	for _, edge := range result.Edges {
		labels = append(labels, edge.From+" -> "+edge.To+" ("+edge.Label+")")
	}
	return labels
}
