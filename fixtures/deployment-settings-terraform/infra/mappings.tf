resource "aws_lambda_event_source_mapping" "ship_orders" {
  event_source_arn        = aws_sqs_queue.shipments.arn
  function_name           = aws_lambda_function.ship_order.arn
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_event_source_mapping" "bill_orders" {
  event_source_arn = aws_sqs_queue.billing.arn
  function_name    = aws_lambda_function.bill_order.arn
}

resource "aws_lambda_event_source_mapping" "pack_orders" {
  event_source_arn                   = aws_sqs_queue.packing.arn
  function_name                      = aws_lambda_function.pack_order.arn
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 10
}

resource "aws_lambda_event_source_mapping" "send_notices" {
  event_source_arn        = aws_sqs_queue.notices.arn
  function_name           = aws_lambda_function.send_notice.arn
  function_response_types = ["ReportBatchItemFailures"]
}
