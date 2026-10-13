resource "aws_sqs_queue" "loans_opened" {
  name                       = "${local.prefix}-loans-opened"
  visibility_timeout_seconds = 60
}

resource "aws_sqs_queue" "returns" {
  name                       = "${local.prefix}-returns"
  visibility_timeout_seconds = 60
}

resource "aws_lambda_event_source_mapping" "archive_loans" {
  event_source_arn = aws_sqs_queue.loans_opened.arn
  function_name    = aws_lambda_function.archive_loan.arn
  batch_size       = 25
}

resource "aws_lambda_event_source_mapping" "process_returns" {
  event_source_arn        = aws_sqs_queue.returns.arn
  function_name           = aws_lambda_function.process_returns.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}
