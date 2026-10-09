terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

variable "prefix" {
  type    = string
  default = "lending"
}

# The branch policy function belongs to each branch's own deployment, and
# nothing in this repository says which one: the renewal workflow's step that
# calls it is left with its placeholder unfilled.
variable "branch_policy_function_arn" {
  type = string
}

locals {
  handlers    = "${path.module}/../src/handlers"
  definitions = "${path.module}/../statemachine"
  role_arn    = "arn:aws:iam::000000000000:role/lending-workflows"
}
