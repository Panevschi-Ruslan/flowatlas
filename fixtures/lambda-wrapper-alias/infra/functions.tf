# One function per handler, all packaged from the same directory. What each one
# exercises is in the handler file it names.

resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "create-loan.handler"
  filename         = data.archive_file.handlers.output_path
  source_code_hash = data.archive_file.handlers.output_base64sha256
}

resource "aws_lambda_function" "renew_loan" {
  function_name    = "${local.prefix}-renew-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "renew-loan.handler"
  filename         = data.archive_file.handlers.output_path
  source_code_hash = data.archive_file.handlers.output_base64sha256
}

resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "record-return.handler"
  filename         = data.archive_file.handlers.output_path
  source_code_hash = data.archive_file.handlers.output_base64sha256
}

resource "aws_lambda_function" "cancel_hold" {
  function_name    = "${local.prefix}-cancel-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "cancel-hold.handler"
  filename         = data.archive_file.handlers.output_path
  source_code_hash = data.archive_file.handlers.output_base64sha256
}

resource "aws_lambda_function" "desk_name" {
  function_name    = "${local.prefix}-desk-name"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "desk-name.handler"
  filename         = data.archive_file.handlers.output_path
  source_code_hash = data.archive_file.handlers.output_base64sha256
}
