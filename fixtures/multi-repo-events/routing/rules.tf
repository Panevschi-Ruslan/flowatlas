terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

data "aws_caller_identity" "current" {}

# The bus is another repository's; it is looked up by name.
data "aws_cloudwatch_event_bus" "library" {
  name = "library"
}

locals {
  account = data.aws_caller_identity.current.account_id
}

# A loan made is welcomed by a function the notifications repository deploys,
# named here by its ARN: the region and account are not known from these
# files, and the function's name is.
resource "aws_cloudwatch_event_rule" "loan_created" {
  name           = "library-loan-created"
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn

  event_pattern = jsonencode({
    source        = ["library.loans"]
    "detail-type" = ["LoanCreated"]
  })
}

resource "aws_cloudwatch_event_target" "welcome_borrower" {
  rule           = aws_cloudwatch_event_rule.loan_created.name
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn
  arn            = "arn:aws:lambda:${var.region}:${local.account}:function:library-welcome-borrower"
}

# Every other loan event goes to a digest queue the notifications repository
# reads. Anything-but is matched as written, so the join is heuristic.
resource "aws_cloudwatch_event_rule" "loan_activity" {
  name           = "library-loan-activity"
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn

  event_pattern = jsonencode({
    source        = ["library.loans"]
    "detail-type" = [{ "anything-but" = ["LoanCreated"] }]
  })
}

resource "aws_cloudwatch_event_target" "loan_digest" {
  rule           = aws_cloudwatch_event_rule.loan_activity.name
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn
  arn            = "arn:aws:sqs:${var.region}:${local.account}:library-loan-digest"
}

# A partner's catalogue updates, which no configured service puts.
resource "aws_cloudwatch_event_rule" "partner_titles" {
  name           = "library-partner-titles"
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn

  event_pattern = jsonencode({
    source = [{ prefix = "partner." }]
  })
}

resource "aws_cloudwatch_event_target" "partner_titles" {
  rule           = aws_cloudwatch_event_rule.partner_titles.name
  event_bus_name = data.aws_cloudwatch_event_bus.library.arn
  arn            = "arn:aws:sqs:${var.region}:${local.account}:library-loan-digest"
}
