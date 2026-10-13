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

locals {
  prefix = "library-desk"
}

# The bundle is built from the whole of `src`, and every function's handler
# names a module under `handlers`.
data "archive_file" "desk" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/desk.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}
