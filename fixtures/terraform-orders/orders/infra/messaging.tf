# Placed orders wait in a queue for `ship-order`; what it fails on three
# times goes to the dead-letter queue.
resource "aws_sqs_queue" "placed_dlq" {
  name = "${local.prefix}-placed-dlq"
}

resource "aws_sqs_queue" "placed" {
  name = "${local.prefix}-placed"

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.placed_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_lambda_event_source_mapping" "ship_order" {
  event_source_arn = aws_sqs_queue.placed.arn
  function_name    = aws_lambda_function.ship_order.arn
  batch_size       = 10
}

# Shipped orders are said on a topic the customer notice is subscribed to.
resource "aws_sns_topic" "shipped" {
  name = "${local.prefix}-shipped"
}

resource "aws_sns_topic_subscription" "notify_customer" {
  topic_arn = aws_sns_topic.shipped.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify_customer.arn
}

# The orders bus: a cancelled order is refunded, a placed one is shipped.
resource "aws_cloudwatch_event_bus" "orders" {
  name = local.prefix
}

resource "aws_cloudwatch_event_rule" "order_cancelled" {
  name           = "${local.prefix}-order-cancelled"
  event_bus_name = aws_cloudwatch_event_bus.orders.name

  event_pattern = jsonencode({
    source        = ["orders.service"]
    "detail-type" = ["OrderCancelled"]
  })
}

resource "aws_cloudwatch_event_target" "refund_order" {
  rule           = aws_cloudwatch_event_rule.order_cancelled.name
  event_bus_name = aws_cloudwatch_event_bus.orders.name
  arn            = aws_lambda_function.refund_order.arn
}

resource "aws_cloudwatch_event_rule" "order_placed" {
  name           = "${local.prefix}-order-placed"
  event_bus_name = aws_cloudwatch_event_bus.orders.name

  event_pattern = jsonencode({
    source        = ["orders.service"]
    "detail-type" = ["OrderPlaced"]
  })
}

resource "aws_cloudwatch_event_target" "shipping" {
  rule           = aws_cloudwatch_event_rule.order_placed.name
  event_bus_name = aws_cloudwatch_event_bus.orders.name
  arn            = aws_sfn_state_machine.shipping.arn
  role_arn       = aws_iam_role.workflow.arn
}

# Every night at two.
resource "aws_cloudwatch_event_rule" "nightly_report" {
  name                = "${local.prefix}-nightly-report"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "nightly_report" {
  rule = aws_cloudwatch_event_rule.nightly_report.name
  arn  = aws_lambda_function.nightly_report.arn
}
