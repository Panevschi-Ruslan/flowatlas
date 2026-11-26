provider "aws" {
  region = "eu-west-1"
}

# What the platform writes to parameters of the account, read back by name.
data "aws_ssm_parameter" "clicks" {
  name = "/shop/clicks/stream-arn"
}

data "aws_ssm_parameter" "jobs_queue" {
  name = "/shop/jobs/queue-arn"
}

data "aws_ssm_parameter" "fulfil" {
  name = "/shop/fulfil/function-arn"
}

data "archive_file" "ledger" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/ledger.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-ledger-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "tally" {
  function_name = "shop-ledger-tally"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "tally.handler"
  filename      = data.archive_file.ledger.output_path
}

resource "aws_sqs_queue" "tally_failures" {
  name = "shop-ledger-tally-failures"
}

# The platform's clicks: a stream or a table's changes, which only the
# platform says; what the mapping gives up on goes to the ledger's own queue.
resource "aws_lambda_event_source_mapping" "clicks" {
  event_source_arn  = data.aws_ssm_parameter.clicks.value
  function_name     = aws_lambda_function.tally.arn
  starting_position = "LATEST"

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.tally_failures.arn
    }
  }
}

# A rule whose target is the platform's jobs queue - or a function, a topic,
# a bus or a workflow, which only the platform says.
resource "aws_cloudwatch_event_rule" "settled" {
  name = "shop-ledger-settled"
  event_pattern = jsonencode({
    source        = ["ledger"]
    "detail-type" = ["EntrySettled"]
  })
}

resource "aws_cloudwatch_event_target" "settled_jobs" {
  rule = aws_cloudwatch_event_rule.settled.name
  arn  = data.aws_ssm_parameter.jobs_queue.value
}

# The platform's fulfil function, subscribed to the ledger's topic: the
# protocol says it is a function.
resource "aws_sns_topic" "entries" {
  name = "shop-ledger-entries"
}

resource "aws_sns_topic_subscription" "fulfil" {
  topic_arn = aws_sns_topic.entries.arn
  protocol  = "lambda"
  endpoint  = data.aws_ssm_parameter.fulfil.value
}
