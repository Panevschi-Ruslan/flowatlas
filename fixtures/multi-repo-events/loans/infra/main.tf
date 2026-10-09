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

# The shared bus, owned by the platform-events repository.
data "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

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

resource "aws_lambda_function" "create_loan" {
  function_name    = "library-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-loan.handler"
  filename         = data.archive_file.loans.output_path
  source_code_hash = data.archive_file.loans.output_base64sha256

  environment {
    variables = {
      EVENT_BUS_NAME = data.aws_cloudwatch_event_bus.library.name
    }
  }
}

resource "aws_lambda_function" "return_loan" {
  function_name    = "library-return-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "return-loan.handler"
  filename         = data.archive_file.loans.output_path
  source_code_hash = data.archive_file.loans.output_base64sha256

  environment {
    variables = {
      EVENT_BUS_NAME = data.aws_cloudwatch_event_bus.library.arn
    }
  }
}

resource "aws_apigatewayv2_api" "loans" {
  name          = "library-loans"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create_loan" {
  api_id                 = aws_apigatewayv2_api.loans.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_loan" {
  api_id    = aws_apigatewayv2_api.loans.id
  route_key = "POST /loans"
  target    = "integrations/${aws_apigatewayv2_integration.create_loan.id}"
}

resource "aws_apigatewayv2_integration" "return_loan" {
  api_id                 = aws_apigatewayv2_api.loans.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.return_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "return_loan" {
  api_id    = aws_apigatewayv2_api.loans.id
  route_key = "POST /loans/{loanId}/return"
  target    = "integrations/${aws_apigatewayv2_integration.return_loan.id}"
}
