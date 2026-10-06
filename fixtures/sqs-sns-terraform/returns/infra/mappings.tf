resource "aws_lambda_event_source_mapping" "process_returns" {
  event_source_arn        = aws_sqs_queue.returns.arn
  function_name           = aws_lambda_function.process_return.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "restock" {
  event_source_arn = module.restock_queue.queue_arn
  function_name    = aws_lambda_function.restock.function_name
}

resource "aws_lambda_event_source_mapping" "send_reminders" {
  event_source_arn = aws_sqs_queue.reminders.arn
  function_name    = aws_lambda_function.send_reminder.arn

  # Recorded on the consumer and not matched on.
  filter_criteria {
    filter {
      pattern = jsonencode({ body = { borrowerId = [{ exists = true }] } })
    }
  }
}

resource "aws_lambda_event_source_mapping" "place_holds" {
  event_source_arn = aws_sqs_queue.hold_requests.arn
  function_name    = aws_lambda_function.place_hold.arn
}
