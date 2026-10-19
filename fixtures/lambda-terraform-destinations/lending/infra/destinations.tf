# request-loan is invoked without waiting: a success runs notify-member, a
# failure is queued.
resource "aws_sqs_queue" "loan_failures" {
  name = "library-loan-failures"
}

resource "aws_lambda_function_event_invoke_config" "request_loan" {
  function_name = aws_lambda_function.fn["request-loan"].function_name

  destination_config {
    on_success {
      destination = aws_lambda_function.fn["notify-member"].arn
    }
    on_failure {
      destination = aws_sqs_queue.loan_failures.arn
    }
  }
}

# return-item's results go on to the library's bus, its failures to a topic.
resource "aws_cloudwatch_event_bus" "library" {
  name = "library-events"
}

resource "aws_sns_topic" "return_alerts" {
  name = "library-return-alerts"
}

resource "aws_lambda_function_event_invoke_config" "return_item" {
  function_name = aws_lambda_function.fn["return-item"].function_name

  destination_config {
    on_success {
      destination = aws_cloudwatch_event_bus.library.arn
    }
    on_failure {
      destination = aws_sns_topic.return_alerts.arn
    }
  }
}

# A rule taking the successful results the platform puts on the bus.
resource "aws_cloudwatch_event_rule" "returned" {
  name           = "library-returned"
  event_bus_name = aws_cloudwatch_event_bus.library.name

  event_pattern = jsonencode({
    source        = ["lambda"]
    "detail-type" = ["Lambda Function Invocation Result - Success"]
  })
}

resource "aws_cloudwatch_event_target" "audit_return" {
  rule           = aws_cloudwatch_event_rule.returned.name
  event_bus_name = aws_cloudwatch_event_bus.library.name
  arn            = aws_lambda_function.fn["audit-return"].arn
}

# Shelf scans read in order; a batch the mapping gives up on goes to the topic.
resource "aws_kinesis_stream" "shelf_scans" {
  name        = "library-shelf-scans"
  shard_count = 1
}

resource "aws_lambda_event_source_mapping" "shelf_scan" {
  event_source_arn  = aws_kinesis_stream.shelf_scans.arn
  function_name     = aws_lambda_function.fn["shelf-scan"].arn
  starting_position = "LATEST"

  destination_config {
    on_failure {
      destination_arn = aws_sns_topic.return_alerts.arn
    }
  }
}

# The card lookup's failures go to an alert the members service deploys,
# named by its ARN.
resource "aws_lambda_function_event_invoke_config" "card_lookup" {
  function_name = aws_lambda_function.fn["card-lookup"].function_name

  destination_config {
    on_failure {
      destination = "arn:aws:lambda:eu-west-1:111122223333:function:library-members-alert"
    }
  }
}

# The members service's digest, configured from here: its results tell the
# member through notify-member.
resource "aws_lambda_function_event_invoke_config" "member_digest" {
  function_name = "library-members-digest"

  destination_config {
    on_success {
      destination = aws_lambda_function.fn["notify-member"].arn
    }
  }
}
