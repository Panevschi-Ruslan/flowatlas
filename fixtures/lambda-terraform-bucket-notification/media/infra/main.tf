terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "library"
  environment = {
    UPLOADS_BUCKET = aws_s3_bucket.uploads.id
  }
}

resource "aws_s3_bucket" "uploads" {
  bucket = "${local.prefix}-cover-uploads"
}

resource "aws_s3_bucket" "archive" {
  bucket = "${local.prefix}-cover-archive"
}

resource "aws_sqs_queue" "thumbnails" {
  name = "${local.prefix}-thumbnails"
}

data "archive_file" "media" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/media.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-media-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "upload_cover" {
  function_name    = "${local.prefix}-upload-cover"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "uploads/upload-cover.handler"
  filename         = data.archive_file.media.output_path
  source_code_hash = data.archive_file.media.output_base64sha256

  environment {
    variables = local.environment
  }
}

resource "aws_lambda_function" "sign_cover" {
  function_name    = "${local.prefix}-sign-cover"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "uploads/sign-cover.handler"
  filename         = data.archive_file.media.output_path
  source_code_hash = data.archive_file.media.output_base64sha256

  environment {
    variables = local.environment
  }
}

resource "aws_lambda_function" "make_thumbnail" {
  function_name    = "${local.prefix}-make-thumbnail"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "uploads/make-thumbnail.handler"
  filename         = data.archive_file.media.output_path
  source_code_hash = data.archive_file.media.output_base64sha256

  environment {
    variables = local.environment
  }
}

resource "aws_lambda_function" "index_thumbnail" {
  function_name    = "${local.prefix}-index-thumbnail"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "uploads/index-thumbnail.handler"
  filename         = data.archive_file.media.output_path
  source_code_hash = data.archive_file.media.output_base64sha256
}

resource "aws_lambda_function" "record_archived" {
  function_name    = "${local.prefix}-record-archived"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "uploads/record-archived.handler"
  filename         = data.archive_file.media.output_path
  source_code_hash = data.archive_file.media.output_base64sha256
}

resource "aws_apigatewayv2_api" "media" {
  name          = "library-media"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "upload_cover" {
  api_id                 = aws_apigatewayv2_api.media.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.upload_cover.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "upload_cover" {
  api_id    = aws_apigatewayv2_api.media.id
  route_key = "POST /covers/{isbn}"
  target    = "integrations/${aws_apigatewayv2_integration.upload_cover.id}"
}

resource "aws_apigatewayv2_integration" "sign_cover" {
  api_id                 = aws_apigatewayv2_api.media.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sign_cover.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sign_cover" {
  api_id    = aws_apigatewayv2_api.media.id
  route_key = "POST /covers/{isbn}/url"
  target    = "integrations/${aws_apigatewayv2_integration.sign_cover.id}"
}
