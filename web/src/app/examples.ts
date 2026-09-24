/**
 * The workspace a first-time visitor lands in: small enough to read in one go,
 * and showing containment, values that resolve, values that honestly cannot,
 * and one connection worth drawing.
 */
const AWS_WEB_APP: Record<string, string> = {
  'main.tf': `# Everything here runs in your browser. Nothing is uploaded.

provider "aws" {
  region = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "staging"
}

locals {
  name_prefix = "terravisual-\${var.environment}"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  name       = local.name_prefix
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet("10.0.0.0/16", 8, 1)
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet("10.0.0.0/16", 8, 2)
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_instance" "web" {
  subnet_id     = aws_subnet.public.id
  instance_type = "t3.micro"
  name          = "\${local.name_prefix}-web"
}

resource "aws_db_subnet_group" "main" {
  subnet_ids = [aws_subnet.private.id]
}

resource "aws_db_instance" "primary" {
  db_subnet_group_name = aws_db_subnet_group.main.name
  instance_class       = "db.t3.micro"
}
`,
};

const AWS_SERVERLESS: Record<string, string> = {
  'main.tf': `# Serverless: nothing here lives in a network, so nothing is nested.
# Permissions are not drawn as arrows; select the function to see its role.

provider "aws" {
  region = "us-east-1"
}

resource "aws_iam_role" "handler" {
  name = "thumbnail-handler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "thumbnails" {
  function_name = "make-thumbnails"
  role          = aws_iam_role.handler.arn
  runtime       = "python3.12"
  handler       = "main.handler"
  filename      = "thumbnails.zip"
}

resource "aws_s3_bucket" "uploads" {
  bucket = "photo-uploads"
}

resource "aws_cloudwatch_log_group" "thumbnails" {
  name              = "/aws/lambda/\${aws_lambda_function.thumbnails.function_name}"
  retention_in_days = 14
}
`,
};

const AZURE_VM: Record<string, string> = {
  'main.tf': `# Azure nests differently from AWS: everything lives in a resource group,
# and a virtual machine attaches to its subnet through a network interface.

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "app" {
  name     = "rg-learning"
  location = "westeurope"
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-main"
  resource_group_name = azurerm_resource_group.app.name
  location            = azurerm_resource_group.app.location
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_subnet" "web" {
  name                 = "snet-web"
  resource_group_name  = azurerm_resource_group.app.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_network_interface" "web" {
  name                = "nic-web"
  resource_group_name = azurerm_resource_group.app.name
  location            = azurerm_resource_group.app.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.web.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_linux_virtual_machine" "web" {
  name                  = "vm-web"
  resource_group_name   = azurerm_resource_group.app.name
  location              = azurerm_resource_group.app.location
  size                  = "Standard_B1s"
  admin_username        = "learner"
  network_interface_ids = [azurerm_network_interface.web.id]
}

resource "azurerm_storage_account" "logs" {
  name                     = "stlearninglogs"
  resource_group_name      = azurerm_resource_group.app.name
  location                 = azurerm_resource_group.app.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`,
};

const GCP_VM: Record<string, string> = {
  'main.tf': `# In Google Cloud a network is global and its subnetworks are regional, so
# the instance sits in a subnetwork inside a network, and the bucket in neither.

provider "google" {
  project = "learning-project"
  region  = "europe-west1"
}

resource "google_compute_network" "main" {
  name                    = "main"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "web" {
  name          = "web"
  network       = google_compute_network.main.id
  ip_cidr_range = "10.10.0.0/24"
  region        = "europe-west1"
}

resource "google_compute_firewall" "allow_http" {
  name          = "allow-http"
  network       = google_compute_network.main.name
  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }
}

resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-small"
  zone         = "europe-west1-b"

  network_interface {
    subnetwork = google_compute_subnetwork.web.id
  }
}

resource "google_storage_bucket" "assets" {
  name     = "learning-assets"
  location = "EU"
}
`,
};

const MODULES: Record<string, string> = {
  'main.tf': `# A root module calling a child module. Open modules/network/main.tf from
# the file tabs: its resources are drawn inside the module's box.

provider "aws" {
  region = "eu-central-1"
}

module "network" {
  source = "./modules/network"
  cidr   = "10.20.0.0/16"
}

resource "aws_instance" "app" {
  instance_type = "t3.small"
  subnet_id     = module.network.subnet_id
}
`,
  'modules/network/main.tf': `variable "cidr" {
  type = string
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.this.id
  cidr_block = cidrsubnet(var.cidr, 8, 1)
}

output "subnet_id" {
  value = aws_subnet.private.id
}
`,
};

export type Example = {
  id: string;
  title: string;
  /** What it teaches, in one sentence. */
  summary: string;
  files: Record<string, string>;
};

export const EXAMPLES: readonly Example[] = [
  {
    id: 'aws-web-app',
    title: 'AWS web app',
    summary: 'A VPC with public and private subnets, a server, a database and a route out.',
    files: AWS_WEB_APP,
  },
  {
    id: 'aws-serverless',
    title: 'AWS serverless',
    summary: 'A function, its role, a bucket and its logs: services that live outside any network.',
    files: AWS_SERVERLESS,
  },
  {
    id: 'azure-vm',
    title: 'Azure virtual machine',
    summary: 'A resource group, a virtual network and a VM attached through its network interface.',
    files: AZURE_VM,
  },
  {
    id: 'gcp-vm',
    title: 'Google Cloud instance',
    summary: 'A global network, a regional subnetwork, a firewall rule, an instance and a bucket.',
    files: GCP_VM,
  },
  {
    id: 'modules',
    title: 'Modules',
    summary: 'A root module calling a network module in another folder, across two files.',
    files: MODULES,
  },
];

export const STARTER_WORKSPACE = AWS_WEB_APP;
