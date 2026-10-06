terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
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

resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/create-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "renew_loan" {
  function_name    = "${local.prefix}-renew-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/renew-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_apigatewayv2_api" "circulation" {
  name          = "library-circulation"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create_loan" {
  api_id                 = aws_apigatewayv2_api.circulation.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_loan" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /loans"
  target    = "integrations/${aws_apigatewayv2_integration.create_loan.id}"
}

resource "aws_apigatewayv2_integration" "renew_loan" {
  api_id                 = aws_apigatewayv2_api.circulation.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.renew_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "renew_loan" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /loans/{loanId}/renewals"
  target    = "integrations/${aws_apigatewayv2_integration.renew_loan.id}"
}
