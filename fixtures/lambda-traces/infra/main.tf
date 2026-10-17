provider "aws" {
  region = "eu-west-1"
}

# The orders table, with a stream: every order written runs `index-orders`.
resource "aws_dynamodb_table" "orders" {
  name             = "orders"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "orderId"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "orderId"
    type = "S"
  }
}

resource "aws_sqs_queue" "order_placed" {
  name = "order-placed"
}

resource "aws_sns_topic" "receipts" {
  name = "receipts"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/handlers.zip"
}

locals {
  role_arn = "arn:aws:iam::111122223333:role/shop-functions"
}

resource "aws_lambda_function" "checkout" {
  function_name = "checkout"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/checkout.handler"
  filename      = data.archive_file.handlers.output_path

  environment {
    variables = {
      ORDERS_TABLE     = aws_dynamodb_table.orders.name
      ORDER_PLACED_URL = aws_sqs_queue.order_placed.url
      FULFIL_ORDER_ARN = aws_sfn_state_machine.fulfil_order.arn
    }
  }
}

resource "aws_lambda_function" "reserve_stock" {
  function_name = "reserve-stock"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/reserve-stock.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "charge_card" {
  function_name = "charge-card"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/charge-card.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "ship_order" {
  function_name = "ship-order"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/ship-order.handler"
  filename      = data.archive_file.handlers.output_path

  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_lambda_function" "print_label" {
  function_name = "print-label"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/print-label.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "index_orders" {
  function_name = "index-orders"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/index-orders.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_event_source_mapping" "ship_order" {
  event_source_arn = aws_sqs_queue.order_placed.arn
  function_name    = aws_lambda_function.ship_order.arn
}

resource "aws_lambda_event_source_mapping" "index_orders" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = aws_lambda_function.index_orders.arn
  starting_position = "LATEST"
}

resource "aws_apigatewayv2_api" "shop" {
  name          = "shop"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "checkout" {
  api_id                 = aws_apigatewayv2_api.shop.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.checkout.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "checkout" {
  api_id    = aws_apigatewayv2_api.shop.id
  route_key = "POST /checkout"
  target    = "integrations/${aws_apigatewayv2_integration.checkout.id}"
}

resource "aws_sfn_state_machine" "fulfil_order" {
  name     = "fulfil-order"
  role_arn = "arn:aws:iam::111122223333:role/shop-workflows"

  definition = templatefile("${path.module}/../statemachine/fulfil-order.asl.json", {
    reserve_stock_arn = aws_lambda_function.reserve_stock.arn
    charge_card_arn   = aws_lambda_function.charge_card.arn
    orders_table      = aws_dynamodb_table.orders.name
    receipts_arn      = aws_sns_topic.receipts.arn
  })
}
