# Shipments: hidden for 120 seconds, under six times the 60-second timeout of
# the function reading it, and handed to its dead-letter queue after 2 receives.
resource "aws_sqs_queue" "shipments" {
  name                       = "${var.prefix}-shipments"
  visibility_timeout_seconds = 120
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.shipments_dead.arn
    maxReceiveCount     = 2
  })
}

resource "aws_sqs_queue" "shipments_dead" {
  name = "${var.prefix}-shipments-dead"
}

# Billing: hidden for 10 seconds, under the 20-second timeout itself, and
# with no redrive policy at all.
resource "aws_sqs_queue" "billing" {
  name                       = "${var.prefix}-billing"
  visibility_timeout_seconds = 10
}

# Packing: hidden for 190 seconds, six times the 30-second timeout plus the
# 10-second batch window; its redrive policy, written as a resource of its own,
# allows 5 receives. Nothing to say.
resource "aws_sqs_queue" "packing" {
  name                       = "${var.prefix}-packing"
  visibility_timeout_seconds = 190
}

resource "aws_sqs_queue" "packing_dead" {
  name = "${var.prefix}-packing-dead"
}

resource "aws_sqs_queue_redrive_policy" "packing" {
  queue_url = aws_sqs_queue.packing.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.packing_dead.arn
    maxReceiveCount     = 5
  })
}

# Notices: the visibility timeout is a variable nothing sets, and the redrive
# policy is JSON text allowing 10 receives.
resource "aws_sqs_queue" "notices" {
  name                       = "${var.prefix}-notices"
  visibility_timeout_seconds = var.notice_visibility_seconds
  redrive_policy             = <<-EOT
    {"deadLetterTargetArn": "arn:aws:sqs:eu-west-1:000000000000:shop-notices-dead", "maxReceiveCount": 10}
  EOT
}
