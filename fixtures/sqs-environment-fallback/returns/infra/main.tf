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
  prefix = "library"
}

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

resource "aws_api_gateway_rest_api" "returns" {
  name = "library-returns"
}

resource "aws_api_gateway_resource" "returns" {
  rest_api_id = aws_api_gateway_rest_api.returns.id
  parent_id   = aws_api_gateway_rest_api.returns.root_resource_id
  path_part   = "returns"
}

resource "aws_api_gateway_method" "record_return" {
  rest_api_id   = aws_api_gateway_rest_api.returns.id
  resource_id   = aws_api_gateway_resource.returns.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "record_return" {
  rest_api_id             = aws_api_gateway_rest_api.returns.id
  resource_id             = aws_api_gateway_resource.returns.id
  http_method             = aws_api_gateway_method.record_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.record_return.invoke_arn
}

resource "aws_api_gateway_resource" "bulk" {
  rest_api_id = aws_api_gateway_rest_api.returns.id
  parent_id   = aws_api_gateway_resource.returns.id
  path_part   = "bulk"
}

resource "aws_api_gateway_method" "bulk_return" {
  rest_api_id   = aws_api_gateway_rest_api.returns.id
  resource_id   = aws_api_gateway_resource.bulk.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "bulk_return" {
  rest_api_id             = aws_api_gateway_rest_api.returns.id
  resource_id             = aws_api_gateway_resource.bulk.id
  http_method             = aws_api_gateway_method.bulk_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.bulk_return.invoke_arn
}
