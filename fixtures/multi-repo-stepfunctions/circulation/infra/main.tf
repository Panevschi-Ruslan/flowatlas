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

resource "aws_dynamodb_table" "loans" {
  name         = "circulation-loans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "loanId"

  attribute {
    name = "loanId"
    type = "S"
  }
}

resource "aws_sfn_state_machine" "checkout" {
  name     = "circulation-checkout"
  role_arn = "arn:aws:iam::000000000000:role/circulation-workflows"

  definition = templatefile("${path.module}/../statemachine/checkout.asl.json", {
    check_standing_arn   = data.aws_lambda_function.check_standing.arn
    reserve_copy_arn     = data.aws_lambda_function.reserve_copy.arn
    borrower_notices_arn = data.aws_sfn_state_machine.borrower_notices.arn
    loans_table          = aws_dynamodb_table.loans.name
  })
}
