terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
}

variable "prefix" {
  type    = string
  default = "lending"
}

locals {
  role_arn = "arn:aws:iam::111122223333:role/lending-functions"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/handlers.zip"
}

resource "aws_sfn_state_machine" "loan_approval" {
  name       = "${var.prefix}-loan-approval"
  role_arn   = "arn:aws:iam::111122223333:role/lending-workflows"
  definition = file("${path.module}/../statemachine/loan-approval.asl.json")
}
