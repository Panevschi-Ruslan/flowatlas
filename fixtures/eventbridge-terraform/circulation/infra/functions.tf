resource "aws_lambda_function" "create_loan" {
  function_name    = "${local.prefix}-create-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "loans/create-loan.handler"
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

resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/record-return.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "notify_borrower" {
  function_name    = "${local.prefix}-notify-borrower"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "notices/notify-borrower.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "review_loan" {
  function_name    = "${local.prefix}-review-loan"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "reviews/review-loan.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "scan_overdue" {
  function_name    = "${local.prefix}-scan-overdue"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "overdue/scan-overdue.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}

resource "aws_lambda_function" "import_cover" {
  function_name    = "${local.prefix}-import-cover"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "covers/import-cover.handler"
  filename         = data.archive_file.circulation.output_path
  source_code_hash = data.archive_file.circulation.output_base64sha256
}
