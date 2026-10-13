terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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

locals {
  prefix = "library"
}

data "aws_caller_identity" "current" {}

data "archive_file" "circulation" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/circulation.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-circulation-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role" "api" {
  name = "${local.prefix}-api-send-message"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_cognito_user_pool" "librarians" {
  name = "${local.prefix}-librarians"
}

resource "aws_sqs_queue" "returns" {
  name = "${local.prefix}-returns"
}

resource "aws_sqs_queue" "holds" {
  name = "${local.prefix}-hold-requests"
}
