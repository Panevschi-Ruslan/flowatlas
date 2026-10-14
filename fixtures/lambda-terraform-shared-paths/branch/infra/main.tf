provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "branch" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/branch.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-branch-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "loans_status" {
  function_name = "library-branch-loans-status"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "status/loans-status.handler"
  filename      = data.archive_file.branch.output_path
}

resource "aws_lambda_function" "events_status" {
  function_name = "library-branch-events-status"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "status/events-status.handler"
  filename      = data.archive_file.branch.output_path
}

resource "aws_lambda_function" "staff_health" {
  function_name = "library-branch-staff-health"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "health/staff-health.handler"
  filename      = data.archive_file.branch.output_path
}

resource "aws_lambda_function" "public_health" {
  function_name = "library-branch-public-health"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "health/public-health.handler"
  filename      = data.archive_file.branch.output_path
}
