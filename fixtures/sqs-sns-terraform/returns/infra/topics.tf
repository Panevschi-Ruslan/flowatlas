resource "aws_sns_topic" "item_returned" {
  name = "${local.prefix}-item-returned"
}

# The topic fans out to a queue and to a function.
resource "aws_sns_topic_subscription" "restock" {
  topic_arn            = aws_sns_topic.item_returned.arn
  protocol             = "sqs"
  endpoint             = module.restock_queue.queue_arn
  raw_message_delivery = true
}

resource "aws_sns_topic_subscription" "notify_borrower" {
  topic_arn = aws_sns_topic.item_returned.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify_borrower.arn

  # Recorded on the subscriber and not matched on.
  filter_policy = jsonencode({
    branchId = ["central"]
  })
}

# A protocol nothing here follows: read, and said.
resource "aws_sns_topic_subscription" "branch_inbox" {
  topic_arn = aws_sns_topic.item_returned.arn
  protocol  = "email"
  endpoint  = "returns-desk@example.org"
}
