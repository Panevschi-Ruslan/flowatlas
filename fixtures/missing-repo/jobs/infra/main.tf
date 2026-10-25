provider "aws" {
  region = "eu-west-1"
}

locals {
  prefix = "acme-jobs"

  handlers = {
    ledger   = "ledger.handler"
    receipts = "receipts.handler"
  }
}

data "archive_file" "jobs" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/jobs.zip"
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
  filename         = data.archive_file.jobs.output_path
  source_code_hash = data.archive_file.jobs.output_base64sha256
}

# The ledger reads the payments stream. Nothing the configured services run
# writes to it: the payments service does, and it is not in the configuration.
resource "aws_kinesis_stream" "payments" {
  name        = "payments"
  shard_count = 1
}

resource "aws_lambda_event_source_mapping" "ledger" {
  event_source_arn  = aws_kinesis_stream.payments.arn
  function_name     = aws_lambda_function.fn["ledger"].arn
  starting_position = "LATEST"
}

# Receipts follow the payments service's own events, by a prefix of their
# source, and nothing configured here puts one on the bus.
resource "aws_cloudwatch_event_rule" "payment_captured" {
  name = "acme-payment-captured"

  event_pattern = jsonencode({
    source        = [{ prefix = "acme.payments" }]
    "detail-type" = ["PaymentCaptured"]
  })
}

resource "aws_cloudwatch_event_target" "receipts" {
  rule = aws_cloudwatch_event_rule.payment_captured.name
  arn  = aws_lambda_function.fn["receipts"].arn
}
