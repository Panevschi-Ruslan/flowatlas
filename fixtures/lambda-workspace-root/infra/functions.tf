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

resource "aws_lambda_function" "check_borrower" {
  function_name = "${var.prefix}-check-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/check-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "score_borrower" {
  function_name = "${var.prefix}-score-borrower"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/score-borrower.handler"
  filename      = data.archive_file.handlers.output_path
}
