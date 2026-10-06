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

resource "aws_api_gateway_rest_api" "loans" {
  name = "${var.prefix}-loans"
}

resource "aws_api_gateway_resource" "loans" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_rest_api.loans.root_resource_id
  path_part   = "loans"
}

resource "aws_api_gateway_method" "create_loan" {
  rest_api_id   = aws_api_gateway_rest_api.loans.id
  resource_id   = aws_api_gateway_resource.loans.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_loan" {
  rest_api_id             = aws_api_gateway_rest_api.loans.id
  resource_id             = aws_api_gateway_resource.loans.id
  http_method             = aws_api_gateway_method.create_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.create_loan.invoke_arn
}
