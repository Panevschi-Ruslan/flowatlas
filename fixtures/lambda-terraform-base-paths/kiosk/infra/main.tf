provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "kiosk" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/kiosk.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-kiosk-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

locals {
  # The public address of the library's API: its custom domain, not a stage URL.
  environment = {
    LIBRARY_API_URL = "https://api.library.example"
  }
}

resource "aws_lambda_function" "check_item" {
  function_name = "library-kiosk-check-item"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "kiosk/check-item.handler"
  filename      = data.archive_file.kiosk.output_path

  environment {
    variables = local.environment
  }
}

resource "aws_lambda_function" "request_hold" {
  function_name = "library-kiosk-request-hold"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "kiosk/request-hold.handler"
  filename      = data.archive_file.kiosk.output_path

  environment {
    variables = local.environment
  }
}
