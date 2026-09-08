variable "environment" {
  type        = string
  default     = "staging"
  description = "Deployment environment"
}

variable "instance_count" {
  type    = number
  default = 3
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "tags" {
  type = map(string)
  default = {
    team    = "platform"
    managed = "terraform"
  }
}

# No default on purpose: this must come back as unknown with a reason, not as
# an empty string.
variable "operator_email" {
  type = string
}
