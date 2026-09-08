/**
 * The workspace a first-time visitor lands in.
 *
 * A blank editor is a bad first screen for a teaching tool: it asks somebody
 * who came here to learn Terraform to already know some. This example is small
 * enough to read in one go and deliberately shows the three things the product
 * is for — containment, values that resolve, and values that honestly cannot.
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

/** The file opened first. */
export const STARTER_FILE = 'main.tf';
