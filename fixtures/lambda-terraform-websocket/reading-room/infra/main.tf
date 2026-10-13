provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "library-reading-room"

  # One function per route, by route key.
  handlers = {
    connect    = "connections/on-connect.handler"
    disconnect = "connections/on-disconnect.handler"
    ask        = "messages/ask-librarian.handler"
    fallback   = "messages/unknown-action.handler"
  }
}

data "archive_file" "reading_room" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/reading-room.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "route" {
  for_each = local.handlers

  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = each.value
  filename         = data.archive_file.reading_room.output_path
  source_code_hash = data.archive_file.reading_room.output_base64sha256
}
