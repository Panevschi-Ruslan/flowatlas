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
  region = var.region
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

# The audit queue belongs to another team and differs per environment; the
# two variable files below say which.
variable "audit_queue_url" {
  type = string
}

locals {
  prefix = "library"
}

data "aws_caller_identity" "current" {}

data "archive_file" "returns" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/returns.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-returns-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}
