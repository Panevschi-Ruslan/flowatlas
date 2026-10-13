# Exact source and detail type: each of these joins its channel by name.
resource "aws_cloudwatch_event_rule" "loan_created" {
  name           = "${local.prefix}-loan-created"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["library.loans"]
    "detail-type" = ["LoanCreated"]
  })
}

resource "aws_cloudwatch_event_target" "notify_on_loan" {
  rule           = aws_cloudwatch_event_rule.loan_created.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  target_id      = "notify-borrower"
  arn            = aws_lambda_function.notify_borrower.arn
}

resource "aws_cloudwatch_event_rule" "hold_requested" {
  name           = "${local.prefix}-hold-requested"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["library.holds"]
    "detail-type" = ["HoldRequested"]
  })
}

resource "aws_cloudwatch_event_target" "notify_on_hold" {
  rule           = aws_cloudwatch_event_rule.hold_requested.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = aws_lambda_function.notify_borrower.arn
}

resource "aws_cloudwatch_event_rule" "item_returned" {
  name           = "${local.prefix}-item-returned"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["library.returns"]
    "detail-type" = ["ItemReturned"]
  })
}

resource "aws_cloudwatch_event_target" "notify_on_return" {
  rule           = aws_cloudwatch_event_rule.item_returned.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = aws_lambda_function.notify_borrower.arn
}

# A prefix: renewals put by any library source start a review once a loan has
# been renewed three times. The source is matched as written and the join is
# heuristic; the filter on the detail is recorded and not matched on.
resource "aws_cloudwatch_event_rule" "renewal_review" {
  name           = "${local.prefix}-renewal-review"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = <<-PATTERN
    {
      "source": [{ "prefix": "library." }],
      "detail-type": ["LoanRenewed"],
      "detail": { "renewals": [{ "numeric": [">=", 3] }] }
    }
  PATTERN
}

resource "aws_cloudwatch_event_target" "review_renewal" {
  rule           = aws_cloudwatch_event_rule.renewal_review.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = aws_sfn_state_machine.loan_review.arn
  role_arn       = aws_iam_role.states.arn
}

# A schedule: a way in on a clock, with nothing publishing to it.
resource "aws_cloudwatch_event_rule" "nightly_overdue" {
  name                = "${local.prefix}-nightly-overdue"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "scan_overdue" {
  rule = aws_cloudwatch_event_rule.nightly_overdue.name
  arn  = aws_lambda_function.scan_overdue.arn
}

# Events nothing in this project puts, on the default bus: a cover uploaded to
# the storage bucket. A way in from outside, not a fault.
resource "aws_cloudwatch_event_rule" "cover_uploaded" {
  name = "${local.prefix}-cover-uploaded"

  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = ["library-covers"] }
    }
  })
}

resource "aws_cloudwatch_event_target" "import_cover" {
  rule = aws_cloudwatch_event_rule.cover_uploaded.name
  arn  = aws_lambda_function.import_cover.arn
}
