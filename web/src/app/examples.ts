/**
 * The workspace a first-time visitor lands in: small enough to read in one go,
 * and showing containment, values that resolve, values that honestly cannot,
 * and one connection worth drawing.
 */
export const STARTER_WORKSPACE: Record<string, string> = {
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
