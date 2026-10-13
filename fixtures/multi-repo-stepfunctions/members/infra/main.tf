terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

locals {
  # Where this repository keeps its state machine definitions. A definition
  # loaded through a local, and not named `*.asl.json`, is found only by
  # evaluating the path: a build watches it as closely as one written in place.
  statemachines = "${path.module}/../statemachine"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../src/handlers"
  output_path = "${path.module}/build/handlers.zip"
}

resource "aws_lambda_function" "check_standing" {
  function_name = "members-check-standing"
  role          = "arn:aws:iam::000000000000:role/members"
  runtime       = "nodejs20.x"
  handler       = "check-standing.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "send_notice" {
  function_name = "members-send-notice"
  role          = "arn:aws:iam::000000000000:role/members"
  runtime       = "nodejs20.x"
  handler       = "send-notice.handler"
  filename      = data.archive_file.handlers.output_path
}

# Started by the checkout workflow in `circulation`, by its ARN.
resource "aws_sfn_state_machine" "borrower_notices" {
  name       = "members-borrower-notices"
  role_arn   = "arn:aws:iam::000000000000:role/members-workflows"
  type       = "EXPRESS"
  definition = file("${local.statemachines}/borrower-notices.json")
}

# Every checkout is published on a topic `circulation` declares; the members
# service keeps count of what each borrower holds.
data "aws_sns_topic" "checkouts" {
  name = "circulation-checkouts"
}

resource "aws_lambda_function" "record_checkout" {
  function_name = "members-record-checkout"
  role          = "arn:aws:iam::000000000000:role/members"
  runtime       = "nodejs20.x"
  handler       = "record-checkout.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_sns_topic_subscription" "record_checkout" {
  topic_arn = data.aws_sns_topic.checkouts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.record_checkout.arn
}

# A borrower asks for a title at the desk: the request goes straight onto the
# library's bus as CheckoutRequested, and no function runs. A rule in
# `circulation` starts the checkout workflow on that event.
data "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

resource "aws_apigatewayv2_api" "members" {
  name          = "members"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "request_checkout" {
  api_id              = aws_apigatewayv2_api.members.id
  integration_type    = "AWS_PROXY"
  integration_subtype = "EventBridge-PutEvents"
  credentials_arn     = "arn:aws:iam::000000000000:role/members-api-put-events"

  request_parameters = {
    EventBusName = data.aws_cloudwatch_event_bus.library.name
    Source       = "library.members"
    DetailType   = "CheckoutRequested"
    Detail       = "$request.body"
  }
}

resource "aws_apigatewayv2_route" "request_checkout" {
  api_id    = aws_apigatewayv2_api.members.id
  route_key = "POST /checkouts"
  target    = "integrations/${aws_apigatewayv2_integration.request_checkout.id}"
}
