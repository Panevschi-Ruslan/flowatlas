# The functions behind the API.

resource "aws_lambda_function" "create_loan" {
  function_name = "${var.prefix}-create-loan"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/create-loan.handler"
  filename      = data.archive_file.handlers.output_path

  environment {
    variables = {
      LOAN_APPROVAL_ARN = aws_sfn_state_machine.loan_approval.arn
    }
  }
}

resource "aws_lambda_function" "renew_loan" {
  function_name = "${var.prefix}-renew-loan"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/renew-loan.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "record_review" {
  function_name = "${var.prefix}-record-review"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/record-review.handler"
  filename      = data.archive_file.handlers.output_path
}

# The functions the API invokes directly.

resource "aws_lambda_function" "hold_copies" {
  function_name = "${var.prefix}-hold-copies"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/hold-copies.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "notify_borrower" {
  function_name = "${var.prefix}-notify-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/notify-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

# The functions the approval workflow invokes.

resource "aws_lambda_function" "check_borrower" {
  function_name = "${var.prefix}-check-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/check-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "request_review" {
  function_name = "${var.prefix}-request-review"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/request-review.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "score_borrower" {
  function_name = "${var.prefix}-score-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/score-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}
