# The default provider deploys to us-east-1; the orders API is created by a
# module handed the aliased one, in eu-west-2.
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "west"
  region = "eu-west-2"
}

# Whoever applies the configuration picks the stage: `-var stage=...`.
variable "stage" {
  type    = string
  default = "staging"
}

# The workspace the configuration is applied in names the payments stage.
locals {
  payments_stage = terraform.workspace
}

module "orders_api" {
  source = "./modules/orders-api"
  stage  = var.stage

  providers = {
    aws = aws.west
  }
}

data "archive_file" "payments" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/payments.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-payments-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "pay" {
  function_name = "shop-pay"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "pay.handler"
  filename      = data.archive_file.payments.output_path
}

resource "aws_apigatewayv2_api" "payments" {
  name          = "shop-payments"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "payments" {
  api_id      = aws_apigatewayv2_api.payments.id
  name        = local.payments_stage
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "pay" {
  api_id                 = aws_apigatewayv2_api.payments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.pay.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "pay" {
  api_id    = aws_apigatewayv2_api.payments.id
  route_key = "POST /payments"
  target    = "integrations/${aws_apigatewayv2_integration.pay.id}"
}
