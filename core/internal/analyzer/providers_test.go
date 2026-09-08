package analyzer

import (
	"testing"
)

// ADR-0004 claims adding a provider means adding data and never touching the
// interface. These tests are where that claim gets checked rather than
// repeated: the Azure and GCP catalogs went in as JSON, and nothing in the
// analyzer knows their names.

func TestAzureContainment(t *testing.T) {
	result := analyzeSource(t, `
resource "azurerm_resource_group" "main" {
  name     = "rg-terravisual"
  location = "westeurope"
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "internal" {
  name                 = "internal"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
}

resource "azurerm_network_interface" "nic" {
  name                = "nic"
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name      = "internal"
    subnet_id = azurerm_subnet.internal.id
  }
}

resource "azurerm_linux_virtual_machine" "web" {
  name                  = "vm"
  resource_group_name   = azurerm_resource_group.main.name
  network_interface_ids = [azurerm_network_interface.nic.id]
}
`)

	nodes := nodesByAddress(result)

	// Resource group, virtual network, subnet, network interface, virtual
	// machine: the chain Azure actually has. A VM reaches its subnet through a
	// network interface, and showing that intermediate step is truthful about
	// how Azure networking works rather than a simplification.
	want := map[string]string{
		"azurerm_virtual_network.main":      "azurerm_resource_group.main",
		"azurerm_subnet.internal":           "azurerm_virtual_network.main",
		"azurerm_network_interface.nic":     "azurerm_subnet.internal",
		"azurerm_linux_virtual_machine.web": "azurerm_network_interface.nic",
	}
	for address, parent := range want {
		if got := nodes[address].ParentID; got != parent {
			t.Errorf("%s parent = %q, want %q", address, got, parent)
		}
	}

	// The subnet is reached through a nested block, which is the case that
	// would silently fail before nested blocks were read.
	if nodes["azurerm_network_interface.nic"].ParentID == "azurerm_resource_group.main" {
		t.Error("the network interface fell back to its resource group, so the nested subnet reference was missed")
	}
}

func TestGcpContainment(t *testing.T) {
	result := analyzeSource(t, `
resource "google_compute_network" "main" {
  name = "vpc"
}

resource "google_compute_subnetwork" "internal" {
  name    = "internal"
  network = google_compute_network.main.id
}

resource "google_compute_instance" "web" {
  name = "web"

  network_interface {
    subnetwork = google_compute_subnetwork.internal.id
  }
}

resource "google_compute_firewall" "allow" {
  name    = "allow"
  network = google_compute_network.main.id
}
`)

	nodes := nodesByAddress(result)

	want := map[string]string{
		"google_compute_subnetwork.internal": "google_compute_network.main",
		"google_compute_instance.web":        "google_compute_subnetwork.internal",
		"google_compute_firewall.allow":      "google_compute_network.main",
	}
	for address, parent := range want {
		if got := nodes[address].ParentID; got != parent {
			t.Errorf("%s parent = %q, want %q", address, got, parent)
		}
	}
}

func TestProvidersAreFramedSeparately(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "a" {}
resource "azurerm_resource_group" "b" { name = "rg" }
resource "google_compute_network" "c" { name = "vpc" }
`)

	nodes := nodesByAddress(result)

	// A workspace using three clouds gets three frames, and each resource
	// lands in its own. Categories are shared across providers on purpose, so
	// a learner can see that a VPC and a VNet play the same role -- but the
	// boxes are not.
	want := map[string]string{
		"aws_vpc.a":                "provider.aws",
		"azurerm_resource_group.b": "provider.azure",
		"google_compute_network.c": "provider.gcp",
	}
	for address, parent := range want {
		if got := nodes[address].ParentID; got != parent {
			t.Errorf("%s parent = %q, want %q", address, got, parent)
		}
	}
}

func TestCategoriesAreComparableAcrossProviders(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "a" {}
resource "azurerm_virtual_network" "b" { name = "vnet" }
resource "google_compute_network" "c" { name = "vpc" }

resource "aws_instance" "d" {}
resource "azurerm_linux_virtual_machine" "e" { name = "vm" }
resource "google_compute_instance" "f" { name = "vm" }
`)

	nodes := nodesByAddress(result)

	for _, address := range []string{"aws_vpc.a", "azurerm_virtual_network.b", "google_compute_network.c"} {
		if got := nodes[address].Category; got != "network" {
			t.Errorf("%s category = %q, want network", address, got)
		}
	}
	for _, address := range []string{"aws_instance.d", "azurerm_linux_virtual_machine.e", "google_compute_instance.f"} {
		if got := nodes[address].Category; got != "compute" {
			t.Errorf("%s category = %q, want compute", address, got)
		}
	}
}
