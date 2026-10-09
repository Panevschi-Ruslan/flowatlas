# The functions behind the API.

resource "aws_lambda_function" "create_loan" {
  function_name = "${var.prefix}-create-loan"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/create-loan.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "resume_run" {
  function_name = "${var.prefix}-resume-run"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/resume-run.handler"
  filename      = data.archive_file.handlers.output_path
}

# Run each morning by a schedule kept with the rest of the library's.

resource "aws_lambda_function" "send_overdue_notices" {
  function_name = "${var.prefix}-send-overdue-notices"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/send-overdue-notices.handler"
  filename      = data.archive_file.handlers.output_path
}

# The functions the workflow and the notifier invoke.

resource "aws_lambda_function" "check_borrower" {
  function_name = "${var.prefix}-check-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/check-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "notify_borrower" {
  function_name = "${var.prefix}-notify-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/notify-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}
