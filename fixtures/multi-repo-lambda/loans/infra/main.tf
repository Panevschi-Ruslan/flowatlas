terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "lending-library-terraform-state"
    key    = "loans/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = "eu-west-1"
}

variable "name_prefix" {
  description = "Prefix of every name this service deploys, one per environment."
  type        = string
  default     = "library"
}

# The shared API, read from the platform's state.
data "terraform_remote_state" "platform" {
  backend = "s3"

  config = {
    bucket = "lending-library-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "eu-west-1"
  }
}

locals {
  rest_api_id = data.terraform_remote_state.platform.outputs.rest_api_id
}
