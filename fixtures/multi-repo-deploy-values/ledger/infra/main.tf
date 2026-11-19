provider "aws" {
  region = "eu-west-1"
}

data "aws_region" "current" {}

# The platform's state, whose outputs are its prefix and its stage.
data "terraform_remote_state" "platform" {
  backend = "s3"

  config = {
    bucket = "shop-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "eu-west-1"
  }
}

# What the platform writes to parameters of the account, read back by name.
data "aws_ssm_parameter" "account" {
  name = "/shop/account"
}

data "aws_ssm_parameter" "clicks" {
  name = "/shop/clicks/stream-arn"
}

data "aws_ssm_parameter" "tally_failures" {
  name = "/shop/tally/failures-arn"
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

# The alerts topic's ARN: the region and the account aside, its name built
# of the platform's two outputs and text.
resource "aws_lambda_function" "tally" {
  function_name = "shop-ledger-tally"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "tally.handler"
  filename      = data.archive_file.ledger.output_path

  environment {
    variables = {
      ALERTS_TOPIC_ARN = "arn:aws:sns:${data.aws_region.current.name}:${data.aws_ssm_parameter.account.value}:${data.terraform_remote_state.platform.outputs.prefix}-${data.terraform_remote_state.platform.outputs.stage}-alerts"
    }
  }
}

# The platform's clicks, a stream or a table's changes; what the mapping gives
# up on goes to a queue or a topic the platform writes to a parameter too.
resource "aws_lambda_event_source_mapping" "clicks" {
  event_source_arn  = data.aws_ssm_parameter.clicks.value
  function_name     = aws_lambda_function.tally.arn
  starting_position = "LATEST"

  destination_config {
    on_failure {
      destination_arn = data.aws_ssm_parameter.tally_failures.value
    }
  }
}

# A rule whose target is the platform's jobs queue, named by its prefix.
resource "aws_cloudwatch_event_rule" "settled" {
  name = "shop-ledger-settled"
  event_pattern = jsonencode({
    source        = ["ledger"]
    "detail-type" = ["EntrySettled"]
  })
}

resource "aws_cloudwatch_event_target" "settled_jobs" {
  rule = aws_cloudwatch_event_rule.settled.name
  arn  = "arn:aws:sqs:${data.aws_region.current.name}:${data.aws_ssm_parameter.account.value}:${data.terraform_remote_state.platform.outputs.prefix}-prod-jobs"
}
