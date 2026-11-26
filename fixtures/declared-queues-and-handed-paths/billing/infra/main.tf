provider "aws" {
  region = "eu-west-1"
}

# The billing API is deployed to a stage per workspace: the default
# workspace's is the sandbox, the production workspace's is live.
locals {
  env = {
    default    = { stage = "sandbox" }
    production = { stage = "live" }
  }
}

data "archive_file" "billing" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/billing.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-billing-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "invoices" {
  function_name = "shop-invoices"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "invoices.handler"
  filename      = data.archive_file.billing.output_path
}

resource "aws_apigatewayv2_api" "billing" {
  name          = "shop-billing"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "billing" {
  api_id      = aws_apigatewayv2_api.billing.id
  name        = local.env[terraform.workspace].stage
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "invoices" {
  api_id                 = aws_apigatewayv2_api.billing.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.invoices.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "invoices" {
  api_id    = aws_apigatewayv2_api.billing.id
  route_key = "GET /invoices"
  target    = "integrations/${aws_apigatewayv2_integration.invoices.id}"
}
