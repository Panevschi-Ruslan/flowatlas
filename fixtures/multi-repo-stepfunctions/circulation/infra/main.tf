terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

# What the checkout workflow reaches in the other two repositories, looked up by
# the names those repositories deploy them under.
data "aws_lambda_function" "check_standing" {
  function_name = "members-check-standing"
}

data "aws_lambda_function" "reserve_copy" {
  function_name = "catalogue-reserve-copy"
}

data "aws_sfn_state_machine" "borrower_notices" {
  name = "members-borrower-notices"
}

data "aws_sqs_queue" "copy_pulls" {
  name = "catalogue-copy-pulls"
}

resource "aws_dynamodb_table" "loans" {
  name         = "circulation-loans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "loanId"

  attribute {
    name = "loanId"
    type = "S"
  }
}

# The library's bus, and a topic every checkout is published on. Both are
# circulation's; the other repositories look them up by name.
resource "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

resource "aws_sns_topic" "checkouts" {
  name = "circulation-checkouts"
}

resource "aws_sfn_state_machine" "checkout" {
  name     = "circulation-checkout"
  role_arn = "arn:aws:iam::000000000000:role/circulation-workflows"

  definition = templatefile("${path.module}/../statemachine/checkout.asl.json", {
    check_standing_arn   = data.aws_lambda_function.check_standing.arn
    reserve_copy_arn     = data.aws_lambda_function.reserve_copy.arn
    borrower_notices_arn = data.aws_sfn_state_machine.borrower_notices.arn
    loans_table          = aws_dynamodb_table.loans.name
    copy_pulls_url       = data.aws_sqs_queue.copy_pulls.url
    checkouts_topic_arn  = aws_sns_topic.checkouts.arn
    library_bus_name     = aws_cloudwatch_event_bus.library.name
  })
}

# A checkout asked for at the members service's desk starts the workflow.
resource "aws_cloudwatch_event_rule" "checkout_requested" {
  name           = "circulation-checkout-requested"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["library.members"]
    "detail-type" = ["CheckoutRequested"]
  })
}

resource "aws_cloudwatch_event_target" "checkout" {
  rule           = aws_cloudwatch_event_rule.checkout_requested.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = aws_sfn_state_machine.checkout.arn
  role_arn       = "arn:aws:iam::000000000000:role/circulation-start-checkout"
}
