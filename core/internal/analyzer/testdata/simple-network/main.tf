variable "environment" {
  type    = string
  default = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

locals {
  name_prefix = "${lower("TerraVisual")}-${var.environment}"
  is_prod     = var.environment == "production"
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  name       = local.name_prefix
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(var.vpc_cidr, 8, 1)
}

resource "aws_instance" "web" {
  subnet_id     = aws_subnet.public.id
  instance_type = local.is_prod ? "m5.large" : "t3.micro"
  name          = "${local.name_prefix}-web"
}
