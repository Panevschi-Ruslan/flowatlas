provider "aws" {
  region = "eu-west-1"
}

# Each workspace maps the shop's domain onto a stage of its own: the
# default workspace's is the sandbox, the production workspace's is live.
variable "stage_names" {
  type = map(string)
  default = {
    default    = "sandbox"
    production = "live"
  }
}

locals {
  stage = lookup(var.stage_names, terraform.workspace)
}

data "archive_file" "orders" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/orders.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-orders-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "orders" {
  function_name = "shop-orders"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "orders.handler"
  filename      = data.archive_file.orders.output_path
}

resource "aws_apigatewayv2_api" "orders" {
  name          = "shop-orders"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "orders" {
  api_id      = aws_apigatewayv2_api.orders.id
  name        = local.stage
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "orders" {
  api_id                 = aws_apigatewayv2_api.orders.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "orders" {
  api_id    = aws_apigatewayv2_api.orders.id
  route_key = "GET /orders"
  target    = "integrations/${aws_apigatewayv2_integration.orders.id}"
}

resource "aws_apigatewayv2_domain_name" "shop" {
  domain_name = "api.shop.example.test"

  domain_name_configuration {
    certificate_arn = "arn:aws:acm:eu-west-1:111122223333:certificate/shop"
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

# The mapping names the stage by the workspace too.
resource "aws_apigatewayv2_api_mapping" "orders" {
  api_id          = aws_apigatewayv2_api.orders.id
  domain_name     = aws_apigatewayv2_domain_name.shop.id
  stage           = local.stage
  api_mapping_key = "v1"
}
