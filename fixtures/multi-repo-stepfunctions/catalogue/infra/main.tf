terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../src/handlers"
  output_path = "${path.module}/build/handlers.zip"
}

# Invoked by the checkout workflow in `circulation`, by its name.
resource "aws_lambda_function" "reserve_copy" {
  function_name = "catalogue-reserve-copy"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "reserve-copy.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "reshelve" {
  function_name = "catalogue-reshelve"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "reshelve.handler"
  filename      = data.archive_file.handlers.output_path
}

# The returns workflow is deployed by the library's operations team from
# `workflows/reshelve-returns.asl.json`; nothing here deploys it.

# Every copy a checkout takes off the shelf is a message on this queue, sent by
# the checkout workflow in `circulation` and read by this function.
resource "aws_sqs_queue" "copy_pulls" {
  name = "catalogue-copy-pulls"
}

resource "aws_lambda_function" "pull_copy" {
  function_name = "catalogue-pull-copy"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "pull-copy.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_event_source_mapping" "copy_pulls" {
  event_source_arn = aws_sqs_queue.copy_pulls.arn
  function_name    = aws_lambda_function.pull_copy.arn
  batch_size       = 10
}

# A loan checked out is an event on the library's bus, which `circulation`
# declares; the catalogue counts what is left on the shelf.
data "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

resource "aws_lambda_function" "update_availability" {
  function_name = "catalogue-update-availability"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "update-availability.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_cloudwatch_event_rule" "loan_checked_out" {
  name           = "catalogue-loan-checked-out"
  event_bus_name = data.aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["library.circulation"]
    "detail-type" = ["LoanCheckedOut"]
  })
}

resource "aws_cloudwatch_event_target" "update_availability" {
  rule           = aws_cloudwatch_event_rule.loan_checked_out.name
  event_bus_name = data.aws_cloudwatch_event_bus.library.name
  arn            = aws_lambda_function.update_availability.arn
}
