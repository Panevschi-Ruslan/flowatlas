provider "aws" {
  region = "eu-west-1"
}

# The orders table, with a stream: every write to it runs `order-changed`.
resource "aws_dynamodb_table" "orders" {
  name             = "shop-orders"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "orderId"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "orderId"
    type = "S"
  }
}

# The carts table, with no stream: a write to it reaches nobody.
resource "aws_dynamodb_table" "carts" {
  name         = "shop-carts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "customerId"

  attribute {
    name = "customerId"
    type = "S"
  }
}

resource "aws_kinesis_stream" "clicks" {
  name        = "shop-clicks"
  shard_count = 1
}

data "archive_file" "shop" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/shop.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "place_order" {
  function_name    = "shop-place-order"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/place-order.handler"
  filename         = data.archive_file.shop.output_path
  source_code_hash = data.archive_file.shop.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE = aws_dynamodb_table.orders.name
      CARTS_TABLE  = aws_dynamodb_table.carts.name
    }
  }
}

resource "aws_lambda_function" "order_changed" {
  function_name    = "shop-order-changed"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "orders/order-changed.handler"
  filename         = data.archive_file.shop.output_path
  source_code_hash = data.archive_file.shop.output_base64sha256
}

resource "aws_lambda_function" "track_click" {
  function_name    = "shop-track-click"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "clicks/track-click.handler"
  filename         = data.archive_file.shop.output_path
  source_code_hash = data.archive_file.shop.output_base64sha256
}

resource "aws_lambda_function" "count_clicks" {
  function_name    = "shop-count-clicks"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "clicks/count-clicks.handler"
  filename         = data.archive_file.shop.output_path
  source_code_hash = data.archive_file.shop.output_base64sha256
}

# The table's stream, filtered to inserts and changes: the filter is recorded
# on the edge, and not matched against what is written.
resource "aws_lambda_event_source_mapping" "order_changed" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = aws_lambda_function.order_changed.arn
  starting_position = "LATEST"

  filter_criteria {
    filter {
      pattern = jsonencode({ eventName = ["INSERT", "MODIFY"] })
    }
  }
}

resource "aws_lambda_event_source_mapping" "count_clicks" {
  event_source_arn  = aws_kinesis_stream.clicks.arn
  function_name     = aws_lambda_function.count_clicks.arn
  starting_position = "LATEST"
}

resource "aws_apigatewayv2_api" "shop" {
  name          = "shop"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "place_order" {
  api_id                 = aws_apigatewayv2_api.shop.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.place_order.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "place_order" {
  api_id    = aws_apigatewayv2_api.shop.id
  route_key = "POST /orders"
  target    = "integrations/${aws_apigatewayv2_integration.place_order.id}"
}

resource "aws_apigatewayv2_integration" "track_click" {
  api_id                 = aws_apigatewayv2_api.shop.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.track_click.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "track_click" {
  api_id    = aws_apigatewayv2_api.shop.id
  route_key = "POST /clicks"
  target    = "integrations/${aws_apigatewayv2_integration.track_click.id}"
}
