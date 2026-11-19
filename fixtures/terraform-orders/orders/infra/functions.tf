resource "aws_lambda_function" "place_order" {
  function_name    = "${local.prefix}-place-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/place-order.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE     = aws_dynamodb_table.orders.name
      ORDERS_QUEUE_URL = aws_sqs_queue.placed.url
      ORDERS_BUS_NAME  = aws_cloudwatch_event_bus.orders.name
    }
  }
}

resource "aws_lambda_function" "get_order" {
  function_name    = "${local.prefix}-get-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/get-order.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_lambda_function" "cancel_order" {
  function_name    = "${local.prefix}-cancel-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/cancel-order.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      ORDERS_BUS_NAME = aws_cloudwatch_event_bus.orders.name
    }
  }
}

resource "aws_lambda_function" "list_orders" {
  function_name    = "${local.prefix}-list-orders"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/list-orders.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_lambda_function" "receipt" {
  function_name    = "${local.prefix}-receipt"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/receipt.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "order_changed" {
  function_name    = "${local.prefix}-order-changed"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/order-changed.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "ship_order" {
  function_name    = "${local.prefix}-ship-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "shipping/ship-order.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      INVOICES_BUCKET   = aws_s3_bucket.invoices.bucket
      SHIPPED_TOPIC_ARN = aws_sns_topic.shipped.arn
    }
  }
}

resource "aws_lambda_function" "reserve_stock" {
  function_name    = "${local.prefix}-reserve-stock"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "shipping/reserve-stock.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "charge_payment" {
  function_name    = "${local.prefix}-charge-payment"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "shipping/charge-payment.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "notify_customer" {
  function_name    = "${local.prefix}-notify-customer"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "notices/notify-customer.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "refund_order" {
  function_name    = "${local.prefix}-refund-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "refunds/refund-order.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "nightly_report" {
  function_name    = "${local.prefix}-nightly-report"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "reports/nightly-report.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_lambda_function" "index_invoice" {
  function_name    = "${local.prefix}-index-invoice"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "invoices/index-invoice.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}

resource "aws_lambda_function" "live_socket" {
  function_name    = "${local.prefix}-live-socket"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "live/live-socket.handler"
  filename         = data.archive_file.orders.output_path
  source_code_hash = data.archive_file.orders.output_base64sha256
}
