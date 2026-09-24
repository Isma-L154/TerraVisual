provider "aws" {
  region = "us-east-1"
}

module "network" {
  source = "./modules/network"
  cidr   = "10.0.0.0/16"
}

resource "aws_s3_bucket" "assets" {
  bucket = "imported-assets"
}
