provider "aws" {
  region = "eu-west-1"
}

# The bus other teams hand their events on to.
resource "aws_cloudwatch_event_bus" "audit" {
  name = "library-audit"
}

data "archive_file" "audit" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/audit.zip"
}

resource "aws_iam_role" "lambda" {
  name = "library-audit-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "record_entry" {
  function_name    = "library-audit-record-entry"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "audit/record-entry.handler"
  filename         = data.archive_file.audit.output_path
  source_code_hash = data.archive_file.audit.output_base64sha256
}

resource "aws_lambda_function" "flag_renewal" {
  function_name    = "library-audit-flag-renewal"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "audit/flag-renewal.handler"
  filename         = data.archive_file.audit.output_path
  source_code_hash = data.archive_file.audit.output_base64sha256
}

# Exact source and detail type: joined to the forwarded channel by its name.
resource "aws_cloudwatch_event_rule" "loan_created" {
  name           = "library-audit-loan-created"
  event_bus_name = aws_cloudwatch_event_bus.audit.name

  event_pattern = jsonencode({
    source        = ["library.loans"]
    "detail-type" = ["LoanCreated"]
  })
}

resource "aws_cloudwatch_event_target" "record_entry" {
  rule           = aws_cloudwatch_event_rule.loan_created.name
  event_bus_name = aws_cloudwatch_event_bus.audit.name
  arn            = aws_lambda_function.record_entry.arn
}

# A prefix on the source: matched against the channels the forward put here.
resource "aws_cloudwatch_event_rule" "renewals" {
  name           = "library-audit-renewals"
  event_bus_name = aws_cloudwatch_event_bus.audit.name

  event_pattern = jsonencode({
    source        = [{ prefix = "library." }]
    "detail-type" = ["LoanRenewed"]
  })
}

resource "aws_cloudwatch_event_target" "flag_renewal" {
  rule           = aws_cloudwatch_event_rule.renewals.name
  event_bus_name = aws_cloudwatch_event_bus.audit.name
  arn            = aws_lambda_function.flag_renewal.arn
}
