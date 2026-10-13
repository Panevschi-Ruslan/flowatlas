resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/create-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "get_loan" {
  function_name    = "${local.prefix}-get-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/get-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "renew_loan" {
  function_name    = "${local.prefix}-renew-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/renew-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "process_return" {
  function_name    = "${local.prefix}-process-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/process-return.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "place_hold" {
  function_name    = "${local.prefix}-place-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "holds/place-hold.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "get_item" {
  function_name    = "${local.prefix}-get-item"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "catalogue/get-item.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_event_source_mapping" "returns" {
  event_source_arn = aws_sqs_queue.returns.arn
  function_name    = aws_lambda_function.process_return.arn
}

resource "aws_lambda_event_source_mapping" "holds" {
  event_source_arn = aws_sqs_queue.holds.arn
  function_name    = aws_lambda_function.place_hold.arn
}
