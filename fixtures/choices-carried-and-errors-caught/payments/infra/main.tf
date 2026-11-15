provider "aws" {
  region = "eu-west-1"
}

# Each workspace the configuration is applied in deploys the payments API to
# its own stage; the default workspace's is the sandbox.
variable "stage_names" {
  type = map(string)
  default = {
    default    = "sandbox"
    production = "live"
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
  name        = lookup(var.stage_names, terraform.workspace)
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

# The receipts API is deployed to a stage named after the workspace itself.
resource "aws_apigatewayv2_api" "receipts" {
  name          = "shop-receipts"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "receipts" {
  api_id      = aws_apigatewayv2_api.receipts.id
  name        = terraform.workspace
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "receipt" {
  api_id                 = aws_apigatewayv2_api.receipts.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.pay.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "receipt" {
  api_id    = aws_apigatewayv2_api.receipts.id
  route_key = "GET /receipts"
  target    = "integrations/${aws_apigatewayv2_integration.receipt.id}"
}
