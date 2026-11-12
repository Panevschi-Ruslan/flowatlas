# The region comes from the environment the configuration is applied in
# (AWS_REGION), so no file says it: the API is served in any region.
provider "aws" {}

data "archive_file" "loans" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/loans.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-loans-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "borrow" {
  function_name = "library-borrow"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "borrow.handler"
  filename      = data.archive_file.loans.output_path
}

# An HTTP API at its default stage: https://<id>.execute-api.<region>.amazonaws.com/loans,
# with no stage in the address.
resource "aws_apigatewayv2_api" "loans" {
  name          = "library-loans"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.loans.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "borrow" {
  api_id                 = aws_apigatewayv2_api.loans.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.borrow.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "borrow" {
  api_id    = aws_apigatewayv2_api.loans.id
  route_key = "POST /loans"
  target    = "integrations/${aws_apigatewayv2_integration.borrow.id}"
}
