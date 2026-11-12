terraform {
  backend "s3" {
    bucket = "shop-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "platform" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/platform.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-platform-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_sqs_queue" "jobs" {
  name = "shop-prod-jobs"
}

resource "aws_sqs_queue" "audit" {
  name = "shop-prod-audit"
}

resource "aws_sqs_queue" "tally_failures" {
  name = "shop-prod-tally-failures"
}

resource "aws_kinesis_stream" "clicks" {
  name        = "shop-prod-clicks"
  shard_count = 1
}

resource "aws_sns_topic" "alerts" {
  name = "shop-prod-alerts"
}

resource "aws_lambda_function" "jobs" {
  function_name = "shop-prod-jobs"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "jobs.handler"
  filename      = data.archive_file.platform.output_path
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.jobs.arn
}

resource "aws_sns_topic_subscription" "alerts" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = "ops@example.com"
}

# What the platform writes for the other repositories to read by name.
resource "aws_ssm_parameter" "prefix" {
  name  = "/shop/prefix"
  type  = "String"
  value = "shop"
}

resource "aws_ssm_parameter" "stage" {
  name  = "/shop/stage"
  type  = "String"
  value = "prod"
}

resource "aws_ssm_parameter" "account" {
  name  = "/shop/account"
  type  = "String"
  value = "111122223333"
}

resource "aws_ssm_parameter" "clicks" {
  name  = "/shop/clicks/stream-arn"
  type  = "String"
  value = aws_kinesis_stream.clicks.arn
}

resource "aws_ssm_parameter" "tally_failures" {
  name  = "/shop/tally/failures-arn"
  type  = "String"
  value = aws_sqs_queue.tally_failures.arn
}

# Outputs of the state, which the ledger reads with terraform_remote_state.
output "prefix" {
  value = "shop"
}

output "stage" {
  value = "prod"
}
