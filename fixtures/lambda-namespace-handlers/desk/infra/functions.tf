# One function per entry point. How each handler is exported is in the module
# under src/handlers it names.

resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/loans.createLoan"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256

  environment {
    variables = {
      LOANS_OPENED_QUEUE_URL = aws_sqs_queue.loans_opened.url
    }
  }
}

resource "aws_lambda_function" "renew_loan" {
  function_name    = "${local.prefix}-renew-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/loans.renewLoan"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256
}

resource "aws_lambda_function" "place_hold" {
  function_name    = "${local.prefix}-place-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/holds.placeHold"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256
}

resource "aws_lambda_function" "cancel_hold" {
  function_name    = "${local.prefix}-cancel-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/holds.cancelHold"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256
}

resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/returns.recordReturn"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256

  environment {
    variables = {
      RETURNS_QUEUE_URL = aws_sqs_queue.returns.url
    }
  }
}

resource "aws_lambda_function" "process_returns" {
  function_name    = "${local.prefix}-process-returns"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/consumers.processReturns"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256
}

resource "aws_lambda_function" "archive_loan" {
  function_name    = "${local.prefix}-archive-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handlers/consumers.archiveLoan"
  filename         = data.archive_file.desk.output_path
  source_code_hash = data.archive_file.desk.output_base64sha256
}
