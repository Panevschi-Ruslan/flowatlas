terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "payments" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/payments.zip"
}

resource "aws_sqs_queue" "settled" {
  name = "payments-settled"
}

resource "aws_sqs_queue" "refunded" {
  name = "payments-refunded"
}

# Settles each payment onto the queue it finds for the outcome; allowed two.
resource "aws_lambda_function" "settle" {
  function_name = "payments-settle"
  role          = aws_iam_role.settle.arn
  runtime       = "nodejs20.x"
  handler       = "settle.handler"
  filename      = data.archive_file.payments.output_path
}

resource "aws_iam_role" "settle" {
  name               = "payments-settle"
  assume_role_policy = "{}"
}

data "aws_iam_policy_document" "settle" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.settled.arn, aws_sqs_queue.refunded.arn]
  }
  statement {
    actions   = ["sqs:ListQueues"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "settle" {
  role   = aws_iam_role.settle.id
  policy = data.aws_iam_policy_document.settle.json
}

# Tells whoever the caller names; allowed every topic.
resource "aws_lambda_function" "notify" {
  function_name = "payments-notify"
  role          = aws_iam_role.notify.arn
  runtime       = "nodejs20.x"
  handler       = "notify.handler"
  filename      = data.archive_file.payments.output_path
}

resource "aws_iam_role" "notify" {
  name               = "payments-notify"
  assume_role_policy = "{}"
}

resource "aws_iam_role_policy" "notify" {
  role = aws_iam_role.notify.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "ledger" {
  function_name = "payments-ledger"
  role          = aws_iam_role.settle.arn
  runtime       = "nodejs20.x"
  handler       = "ledger.handler"
  filename      = data.archive_file.payments.output_path
}

resource "aws_lambda_event_source_mapping" "settled" {
  event_source_arn = aws_sqs_queue.settled.arn
  function_name    = aws_lambda_function.ledger.arn
}

resource "aws_lambda_event_source_mapping" "refunded" {
  event_source_arn = aws_sqs_queue.refunded.arn
  function_name    = aws_lambda_function.ledger.arn
}
