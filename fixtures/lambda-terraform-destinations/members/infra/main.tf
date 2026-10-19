provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "members" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/members.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-members-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "alert" {
  function_name    = "library-members-alert"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "alerts/alert.handler"
  filename         = data.archive_file.members.output_path
  source_code_hash = data.archive_file.members.output_base64sha256
}

resource "aws_lambda_function" "digest" {
  function_name    = "library-members-digest"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "digest/digest.handler"
  filename         = data.archive_file.members.output_path
  source_code_hash = data.archive_file.members.output_base64sha256
}
