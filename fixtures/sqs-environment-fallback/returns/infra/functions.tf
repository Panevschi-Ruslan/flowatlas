# Deployed with the queue: the deployment's value wins over the code's default.
resource "aws_lambda_function" "record_return" {
  function_name    = "${local.prefix}-record-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/record-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      RETURNS_QUEUE_URL = aws_sqs_queue.priority_returns.url
    }
  }
}

# Runs the same helper and is not given the queue: the code's default holds.
resource "aws_lambda_function" "bulk_return" {
  function_name    = "${local.prefix}-bulk-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/bulk-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      BATCH_SIZE = "25"
    }
  }
}

# Given the bus and not the topic.
resource "aws_lambda_function" "process_return" {
  function_name    = "${local.prefix}-process-return"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "returns/process-return.handler"
  filename         = data.archive_file.returns.output_path
  source_code_hash = data.archive_file.returns.output_base64sha256

  environment {
    variables = {
      EVENT_BUS_NAME = aws_cloudwatch_event_bus.circulation.name
    }
  }
}

resource "aws_sqs_queue" "returns" {
  name = "${local.prefix}-returns"
}

resource "aws_sqs_queue" "priority_returns" {
  name = "${local.prefix}-priority-returns"
}

resource "aws_sns_topic" "item_returned" {
  name = "${local.prefix}-item-returned"
}

resource "aws_cloudwatch_event_bus" "circulation" {
  name = "${local.prefix}-circulation"
}

resource "aws_lambda_event_source_mapping" "process_returns" {
  event_source_arn = aws_sqs_queue.returns.arn
  function_name    = aws_lambda_function.process_return.arn
}

resource "aws_lambda_event_source_mapping" "process_priority_returns" {
  event_source_arn = aws_sqs_queue.priority_returns.arn
  function_name    = aws_lambda_function.process_return.arn
}
