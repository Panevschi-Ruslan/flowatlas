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

locals {
  prefix = "library"
}

resource "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

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

resource "aws_iam_role" "states" {
  name = "${local.prefix}-loan-review"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_sfn_state_machine" "loan_review" {
  name       = "loan-review"
  role_arn   = aws_iam_role.states.arn
  definition = file("${path.module}/../statemachines/loan-review.asl.json")
}
