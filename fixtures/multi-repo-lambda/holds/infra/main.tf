terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

# Every name this service deploys starts with this. Each environment's file
# sets it, and nothing here says which environment is meant.
variable "name_prefix" {
  type = string
}

# The shared API, found through the parameters the platform writes.
data "aws_ssm_parameter" "api_id" {
  name = "/lending-library/api/id"
}

data "aws_ssm_parameter" "v1_resource_id" {
  name = "/lending-library/api/v1-resource-id"
}
