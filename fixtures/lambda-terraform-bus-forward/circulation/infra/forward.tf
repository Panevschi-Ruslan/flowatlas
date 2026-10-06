# Every event a library source puts on the library bus is handed on to the
# audit team's bus, which another repository owns. The rule takes its events by
# a prefix, so which events those are is whatever the project's publishers put.
data "aws_cloudwatch_event_bus" "audit" {
  name = "library-audit"
}

resource "aws_iam_role" "forward" {
  name = "${local.prefix}-forward-to-audit"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "events.amazonaws.com" }
    }]
  })
}

resource "aws_cloudwatch_event_rule" "to_audit" {
  name           = "${local.prefix}-to-audit"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source = [{ prefix = "library." }]
  })
}

resource "aws_cloudwatch_event_target" "to_audit" {
  rule           = aws_cloudwatch_event_rule.to_audit.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = data.aws_cloudwatch_event_bus.audit.arn
  role_arn       = aws_iam_role.forward.arn
}
