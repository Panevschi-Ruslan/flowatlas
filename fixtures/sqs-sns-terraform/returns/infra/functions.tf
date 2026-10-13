resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/record-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      RETURNS_QUEUE_URL = aws_sqs_queue.returns.url
    }
  }
}

# Runs the same helper as record_return and is not given the queue.
resource "aws_lambda_function" "bulk_return" {
  function_name    = "${local.prefix}-bulk-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/bulk-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      BATCH_SIZE = "25"
    }
  }
}

resource "aws_lambda_function" "process_return" {
  function_name    = "${local.prefix}-process-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/process-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      ITEM_RETURNED_TOPIC_ARN = aws_sns_topic.item_returned.arn
      AUDIT_QUEUE_URL         = var.audit_queue_url
    }
  }
}

resource "aws_lambda_function" "restock" {
  function_name    = "${local.prefix}-restock"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "stock/restock.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}

resource "aws_lambda_function" "notify_borrower" {
  function_name    = "${local.prefix}-notify-borrower"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "notices/notify-borrower.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}

resource "aws_lambda_function" "send_reminder" {
  function_name    = "${local.prefix}-send-reminder"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "notices/send-reminder.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}

resource "aws_lambda_function" "place_hold" {
  function_name    = "${local.prefix}-place-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "holds/place-hold.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256
}
