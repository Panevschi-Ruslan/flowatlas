provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "library-lending"

  handlers = {
    card-lookup   = "cards/card-lookup.handler"
    request-loan  = "loans/request-loan.handler"
    notify-member = "loans/notify-member.handler"
    return-item   = "returns/return-item.handler"
    audit-return  = "returns/audit-return.handler"
    shelf-scan    = "shelves/shelf-scan.handler"
  }
}

data "archive_file" "lending" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/lending.zip"
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
  filename         = data.archive_file.lending.output_path
  source_code_hash = data.archive_file.lending.output_base64sha256
}

# The kiosk is handed the card lookup's URL through the module's output.
module "card_lookup_url" {
  source        = "./modules/function-url"
  function_name = aws_lambda_function.fn["card-lookup"].function_name
}

resource "aws_lambda_function" "kiosk" {
  function_name    = "${local.prefix}-kiosk"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "kiosk/kiosk.handler"
  filename         = data.archive_file.lending.output_path
  source_code_hash = data.archive_file.lending.output_base64sha256

  environment {
    variables = {
      CARD_LOOKUP_URL = module.card_lookup_url.url
    }
  }
}
