# Fixture for issue #1. Every construct here is deliberate: the spike has to
# exercise variables, locals in dependency order, functions from several
# different packages, a conditional, interpolation and count.

locals {
  # Declared before the local it depends on, to prove resolution is not
  # order-dependent.
  name_prefix = "${local.project}-${var.environment}"

  project     = lower("TerraVisual")
  is_prod     = var.environment == "production"
  subnet_bits = 8

  # stdlib collections + encoding
  common_tags = merge(var.tags, {
    environment = var.environment
    prefix      = local.name_prefix
  })

  tag_summary = jsonencode(local.common_tags)

  # go-cty-funcs: cidr package
  public_subnet  = cidrsubnet(var.vpc_cidr, local.subnet_bits, 1)
  private_subnet = cidrsubnet(var.vpc_cidr, local.subnet_bits, 2)

  # go-cty-funcs: crypto package
  config_fingerprint = sha256(local.tag_summary)

  # stdlib strings and numbers
  az_names      = [for i in range(3) : format("%s-%d", var.environment, i)]
  instance_size = local.is_prod ? "m5.large" : "t3.micro"
  max_retries   = max(3, length(local.az_names))

  # Depends on a variable with no default, so it must surface as unknown.
  alert_target = upper(var.operator_email)
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  tags       = local.common_tags
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = local.public_subnet
  availability_zone = element(local.az_names, 0)
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = local.private_subnet
}

resource "aws_instance" "web" {
  count = var.instance_count

  instance_type = local.instance_size
  subnet_id     = aws_subnet.public.id
  name          = "${local.name_prefix}-web-${count.index}"
  retries       = local.max_retries
  fingerprint   = local.config_fingerprint
  alert_to      = local.alert_target
}

resource "aws_db_instance" "primary" {
  identifier     = join("-", [local.name_prefix, "db"])
  instance_class = local.is_prod ? "db.r5.large" : "db.t3.micro"
  subnet_id      = aws_subnet.private.id
  storage        = ceil(20.4)
}
