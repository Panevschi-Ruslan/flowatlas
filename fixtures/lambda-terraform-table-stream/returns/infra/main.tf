provider "aws" {
  region = "eu-west-1"
}

# The shop's table, deployed by the shop and looked up here by its name.
data "aws_dynamodb_table" "orders" {
  name = "shop-orders"
}

data "archive_file" "returns" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/returns.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-returns-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "cancel_order" {
  function_name    = "shop-returns-cancel-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/cancel-order.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}

resource "aws_lambda_function" "clear_orders" {
  function_name    = "shop-returns-clear-orders"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/clear-orders.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE = data.aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_apigatewayv2_api" "returns" {
  name          = "shop-returns"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "cancel_order" {
  api_id                 = aws_apigatewayv2_api.returns.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.cancel_order.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "cancel_order" {
  api_id    = aws_apigatewayv2_api.returns.id
  route_key = "POST /orders/{orderId}/cancel"
  target    = "integrations/${aws_apigatewayv2_integration.cancel_order.id}"
}

resource "aws_apigatewayv2_integration" "clear_orders" {
  api_id                 = aws_apigatewayv2_api.returns.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.clear_orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "clear_orders" {
  api_id    = aws_apigatewayv2_api.returns.id
  route_key = "POST /orders/clear"
  target    = "integrations/${aws_apigatewayv2_integration.clear_orders.id}"
}
