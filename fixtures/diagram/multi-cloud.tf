# Three providers side by side: several top-level frames on one canvas.

provider "aws" {
  region = "us-east-1"
}

provider "azurerm" {
  features {}
}

provider "google" {
  region = "europe-west1"
}

resource "aws_vpc" "a" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}

resource "azurerm_resource_group" "rg" {
  name     = "rg"
  location = "westeurope"
}

resource "azurerm_virtual_network" "vnet" {
  name                = "vnet"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  address_space       = ["10.1.0.0/16"]
}

resource "azurerm_subnet" "sn" {
  name                 = "sn"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.1.1.0/24"]
}

resource "google_compute_network" "net" {
  name = "net"
}

resource "google_compute_subnetwork" "sub" {
  name          = "sub"
  network       = google_compute_network.net.id
  ip_cidr_range = "10.2.0.0/24"
}

resource "google_storage_bucket" "b" {
  name     = "b"
  location = "EU"
}
