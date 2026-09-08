resource "aws_s3_bucket" "assets" {
  bucket = "terravisual-assets"
}

# Broken on purpose: while someone is typing, the file is invalid most of the
# time. The resource above must still appear.
resource "aws_vpc" {
  cidr_block = "10.0.0.0/16
