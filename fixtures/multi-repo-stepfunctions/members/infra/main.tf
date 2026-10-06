terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
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
  definition = file("${path.module}/../statemachine/borrower-notices.asl.json")
}
