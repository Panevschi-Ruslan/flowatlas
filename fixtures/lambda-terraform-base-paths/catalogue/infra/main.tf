provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "catalogue" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/catalogue.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-catalogue-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "get_item" {
  function_name = "library-catalogue-get-item"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "items/get-item.handler"
  filename      = data.archive_file.catalogue.output_path
}

resource "aws_lambda_function" "place_hold" {
  function_name = "library-catalogue-place-hold"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "holds/place-hold.handler"
  filename      = data.archive_file.catalogue.output_path
}

# The library's public domain, which both APIs are published on.
resource "aws_acm_certificate" "library" {
  domain_name       = "api.library.example"
  validation_method = "DNS"
}
