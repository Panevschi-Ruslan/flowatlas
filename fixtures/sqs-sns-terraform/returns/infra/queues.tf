resource "aws_sqs_queue" "returns" {
  name                       = "${local.prefix}-returns"
  visibility_timeout_seconds = 60

  # What processing fails on four times goes to the dead-letter queue, which
  # nothing reads: `dead` says so.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.returns_dlq.arn
    maxReceiveCount     = 4
  })
}

resource "aws_sqs_queue" "returns_dlq" {
  name = "${local.prefix}-returns-dlq"
}

# Through the public module, which creates the queue and its dead-letter queue
# and joins them with a redrive policy of its own.
module "restock_queue" {
  source  = "terraform-aws-modules/sqs/aws"
  version = "~> 4.0"

  name       = "${local.prefix}-restock"
  create_dlq = true
}

resource "aws_sqs_queue" "reminders" {
  name = "${local.prefix}-reminders"
}

resource "aws_sqs_queue" "hold_requests" {
  name = "${local.prefix}-hold-requests"
}
