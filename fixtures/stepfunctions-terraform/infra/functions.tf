data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = local.handlers
  output_path = "${path.module}/build/handlers.zip"
}

resource "aws_lambda_function" "check_borrower" {
  function_name = "${var.prefix}-check-borrower"
  role          = "arn:aws:iam::000000000000:role/lending-functions"
  runtime       = "nodejs20.x"
  handler       = "check-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "score_borrower" {
  function_name = "${var.prefix}-score-borrower"
  role          = "arn:aws:iam::000000000000:role/lending-functions"
  runtime       = "nodejs20.x"
  handler       = "score-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "notify_borrower" {
  function_name = "${var.prefix}-notify-borrower"
  role          = "arn:aws:iam::000000000000:role/lending-functions"
  runtime       = "nodejs20.x"
  handler       = "notify-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "send_overdue_reminder" {
  function_name = "${var.prefix}-send-overdue-reminder"
  role          = "arn:aws:iam::000000000000:role/lending-functions"
  runtime       = "nodejs20.x"
  handler       = "send-overdue-reminder.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "release_hold" {
  function_name = "${var.prefix}-release-hold"
  role          = "arn:aws:iam::000000000000:role/lending-functions"
  runtime       = "nodejs20.x"
  handler       = "release-hold.handler"
  filename      = data.archive_file.handlers.output_path
}

# Through the public module, which ships described.
module "assess_late_fee" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  function_name = "${var.prefix}-assess-late-fee"
  handler       = "assess-late-fee.handler"
  runtime       = "nodejs20.x"
  source_path   = local.handlers
}
