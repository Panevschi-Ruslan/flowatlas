provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "platform" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/platform.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-platform-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_sqs_queue" "jobs" {
  name = "shop-prod-jobs"
}

resource "aws_lambda_function" "jobs" {
  function_name = "shop-prod-jobs"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "jobs.handler"
  filename      = data.archive_file.platform.output_path
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.jobs.arn
}

resource "aws_sqs_queue" "audit" {
  name = "shop-prod-audit"
}

resource "aws_lambda_function" "audit" {
  function_name = "shop-prod-audit"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "audit.handler"
  filename      = data.archive_file.platform.output_path
}

resource "aws_lambda_event_source_mapping" "audit" {
  event_source_arn = aws_sqs_queue.audit.arn
  function_name    = aws_lambda_function.audit.arn
}
