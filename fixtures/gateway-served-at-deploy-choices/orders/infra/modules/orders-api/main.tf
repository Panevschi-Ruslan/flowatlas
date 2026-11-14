# The orders API: a REST API deployed to the stage its caller hands in, and
# mapped onto the shop's domain at `orders`. A caller writes
# `https://api.shop.example/orders/submit`, or the API's own address,
# `https://<id>.execute-api.eu-west-2.amazonaws.com/<stage>/submit`, which
# still answers.
variable "stage" {
  type = string
}

data "archive_file" "orders" {
  type        = "zip"
  source_dir  = "${path.module}/../../../src"
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

resource "aws_lambda_function" "submit" {
  function_name = "shop-submit"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "submit.handler"
  filename      = data.archive_file.orders.output_path
}

resource "aws_api_gateway_rest_api" "orders" {
  name = "shop-orders"
}

resource "aws_api_gateway_resource" "submit" {
  rest_api_id = aws_api_gateway_rest_api.orders.id
  parent_id   = aws_api_gateway_rest_api.orders.root_resource_id
  path_part   = "submit"
}

resource "aws_api_gateway_method" "submit" {
  rest_api_id   = aws_api_gateway_rest_api.orders.id
  resource_id   = aws_api_gateway_resource.submit.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "submit" {
  rest_api_id             = aws_api_gateway_rest_api.orders.id
  resource_id             = aws_api_gateway_resource.submit.id
  http_method             = aws_api_gateway_method.submit.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.submit.invoke_arn
}

resource "aws_api_gateway_deployment" "orders" {
  rest_api_id = aws_api_gateway_rest_api.orders.id
}

resource "aws_api_gateway_stage" "orders" {
  rest_api_id   = aws_api_gateway_rest_api.orders.id
  deployment_id = aws_api_gateway_deployment.orders.id
  stage_name    = var.stage
}

resource "aws_api_gateway_domain_name" "shop" {
  domain_name              = "api.shop.example"
  regional_certificate_arn = "arn:aws:acm:eu-west-2:123456789012:certificate/shop"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "orders" {
  api_id      = aws_api_gateway_rest_api.orders.id
  stage_name  = aws_api_gateway_stage.orders.stage_name
  domain_name = aws_api_gateway_domain_name.shop.domain_name
  base_path   = "orders"
}
