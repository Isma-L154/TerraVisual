# Every badge a node can carry at once: the tallest content a box has to hold.

provider "aws" {
  region = "eu-west-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, 1)
}

resource "aws_instance" "many_unknowns" {
  subnet_id              = aws_subnet.a.id
  vpc_security_group_ids = [aws_vpc.main.default_security_group_id]
  user_data              = aws_subnet.a.arn
}

resource "mystery_widget" "both_flags" {
  subnet_id = aws_subnet.a.id
  vpc_id    = aws_vpc.main.id
}

resource "mystery_widget" "second" {
  subnet_id = aws_subnet.a.id
}

resource "mystery_widget" "third" {
  subnet_id = aws_subnet.a.id
}
