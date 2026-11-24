terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

variable "prefix" {
  type    = string
  default = "shop"
}

# How long the notices queue hides a message is chosen per environment, and
# nothing in this repository chooses: the check that needs it is not made.
variable "notice_visibility_seconds" {
  type = number
}

locals {
  handlers = "${path.module}/../src"
  role_arn = "arn:aws:iam::000000000000:role/shop-workers"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = local.handlers
  output_path = "${path.module}/build/handlers.zip"
}
