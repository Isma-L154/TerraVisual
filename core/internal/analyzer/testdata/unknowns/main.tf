# Every value here is undeterminable for a different reason. The point of the
# case is that each one is explained in terms of the user's code rather than
# reported as a parser failure.

variable "operator_email" {
  type = string
}

data "aws_ami" "ubuntu" {
  most_recent = true
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  alert_to      = var.operator_email
  user_data     = file("cloud-init.yaml")
  generated_at  = timestamp()
  instance_type = "t3.micro"
}
