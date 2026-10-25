provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "library-members"

  handlers = {
    card-lookup       = "url/card-lookup.handler"
    pre-sign-up       = "accounts/pre-sign-up.handler"
    post-confirmation = "accounts/post-confirmation.handler"
    shelf-sensor      = "shelves/shelf-sensor.handler"
    kiosk             = "kiosk/kiosk.handler"
    log-digest        = "logs/log-digest.handler"
    return-desk       = "returns/return-desk.handler"
    restock-shelf     = "returns/restock-shelf.handler"
  }
}

data "archive_file" "members" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/members.zip"
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

resource "aws_lambda_function" "fn" {
  for_each = local.handlers

  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = each.value
  filename         = data.archive_file.members.output_path
  source_code_hash = data.archive_file.members.output_base64sha256
}
