provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "stock" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/stock.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-stock-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# What the platform writes, read by name.
data "aws_ssm_parameter" "prefix" {
  name = "/shop/prefix"
}

data "aws_ssm_parameter" "stage" {
  name = "/shop/stage"
}

variable "stage" {
  type    = string
  default = "prod"
}

# Which region the alerts are raised in: set where the configuration is applied.
variable "secondary" {
  type = bool
}

locals {
  prefix = data.aws_ssm_parameter.prefix.value
  stage  = data.aws_ssm_parameter.stage.value
}

resource "aws_lambda_function" "count" {
  function_name = "shop-stock-count"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "count.handler"
  filename      = data.archive_file.stock.output_path

  environment {
    variables = {
      # A test stage writes to its own queue; any other, the platform's.
      JOBS_QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/111122223333/${local.prefix}-%{ if var.stage == "test" }test%{ else }${local.stage}%{ endif }-jobs"
      # Either region, the same topic.
      ALERTS_TOPIC_ARN = "arn:aws:sns:%{ if var.secondary }eu-central-1%{ else }eu-west-1%{ endif }:111122223333:${local.prefix}-${local.stage}-alerts"
      # Two queues by a condition nothing here decides.
      SPILL_QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/111122223333/${local.prefix}-%{ if var.secondary }spill%{ else }failed%{ endif }"
      FAILED_QUEUE_URL = templatefile("${path.module}/queue-url.tftpl", { prefix = local.prefix, stage = local.stage, parts = ["failed"] })
    }
  }
}
