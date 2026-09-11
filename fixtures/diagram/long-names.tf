# Names far longer than a box: they must truncate inside it and stay readable.

provider "aws" {
  region = "eu-west-1"
}

resource "aws_vpc" "production_primary_network_for_the_payments_platform" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private_application_tier_availability_zone_a" {
  vpc_id     = aws_vpc.production_primary_network_for_the_payments_platform.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "payments_api_primary_instance_with_a_very_long_name" {
  subnet_id     = aws_subnet.private_application_tier_availability_zone_a.id
  instance_type = "t3.micro"
}

resource "some_uncatalogued_thing_with_a_long_type" "and_a_long_label_too_for_good_measure" {
  subnet_id = aws_subnet.private_application_tier_availability_zone_a.id
}
