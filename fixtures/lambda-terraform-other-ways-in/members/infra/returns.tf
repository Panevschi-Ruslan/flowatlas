# A book dropped in a returns chute: its IoT rule writes the return to a table
# whose stream runs the return desk, starts the restocking workflow, archives
# the message through a delivery stream nothing here reads, and queues the
# message with the shelf readings when any of that fails.
resource "aws_dynamodb_table" "returns" {
  name             = "library-members-returns"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "returnId"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "returnId"
    type = "S"
  }
}

resource "aws_lambda_event_source_mapping" "return_desk" {
  event_source_arn  = aws_dynamodb_table.returns.stream_arn
  function_name     = aws_lambda_function.fn["return-desk"].arn
  starting_position = "LATEST"
}

resource "aws_sfn_state_machine" "restock" {
  name     = "library-members-restock"
  role_arn = aws_iam_role.lambda.arn

  definition = jsonencode({
    StartAt = "Restock"
    States = {
      Restock = {
        Type     = "Task"
        Resource = aws_lambda_function.fn["restock-shelf"].arn
        End      = true
      }
    }
  })
}

resource "aws_iot_topic_rule" "book_returned" {
  name        = "library_book_returned"
  enabled     = true
  sql         = "SELECT * FROM 'library/returns/+/dropped'"
  sql_version = "2016-03-23"

  dynamodbv2 {
    role_arn = aws_iam_role.lambda.arn

    put_item {
      table_name = aws_dynamodb_table.returns.name
    }
  }

  step_functions {
    state_machine_name    = aws_sfn_state_machine.restock.name
    execution_name_prefix = "returned"
    role_arn              = aws_iam_role.lambda.arn
  }

  firehose {
    delivery_stream_name = "library-members-returns-archive"
    role_arn             = aws_iam_role.lambda.arn
  }

  error_action {
    sqs {
      queue_url  = aws_sqs_queue.shelf_readings.id
      role_arn   = aws_iam_role.lambda.arn
      use_base64 = false
    }
  }
}
