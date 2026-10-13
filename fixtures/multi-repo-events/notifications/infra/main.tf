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

data "archive_file" "notifications" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/notifications.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-notifications-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "welcome_borrower" {
  function_name    = "library-welcome-borrower"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "welcome-borrower.handler"
  filename         = data.archive_file.notifications.output_path
  source_code_hash = data.archive_file.notifications.output_base64sha256
}

resource "aws_lambda_function" "loan_digest" {
  function_name    = "library-loan-digest"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loan-digest.handler"
  filename         = data.archive_file.notifications.output_path
  source_code_hash = data.archive_file.notifications.output_base64sha256
}

resource "aws_sqs_queue" "loan_digest" {
  name = "library-loan-digest"
}

resource "aws_lambda_event_source_mapping" "loan_digest" {
  event_source_arn = aws_sqs_queue.loan_digest.arn
  function_name    = aws_lambda_function.loan_digest.arn
  batch_size       = 25
}
