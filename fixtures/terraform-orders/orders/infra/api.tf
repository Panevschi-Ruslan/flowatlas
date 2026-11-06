# The REST API: POST /orders, GET and DELETE /orders/{id}.
resource "aws_api_gateway_rest_api" "orders" {
  name = "${var.stage}-orders"
}

resource "aws_api_gateway_resource" "orders" {
  rest_api_id = aws_api_gateway_rest_api.orders.id
  parent_id   = aws_api_gateway_rest_api.orders.root_resource_id
  path_part   = "orders"
}

resource "aws_api_gateway_resource" "order" {
  rest_api_id = aws_api_gateway_rest_api.orders.id
  parent_id   = aws_api_gateway_resource.orders.id
  path_part   = "{id}"
}

resource "aws_api_gateway_method" "place_order" {
  rest_api_id   = aws_api_gateway_rest_api.orders.id
  resource_id   = aws_api_gateway_resource.orders.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "place_order" {
  rest_api_id             = aws_api_gateway_rest_api.orders.id
  resource_id             = aws_api_gateway_resource.orders.id
  http_method             = aws_api_gateway_method.place_order.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.place_order.invoke_arn
}

resource "aws_api_gateway_method" "get_order" {
  rest_api_id   = aws_api_gateway_rest_api.orders.id
  resource_id   = aws_api_gateway_resource.order.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_order" {
  rest_api_id             = aws_api_gateway_rest_api.orders.id
  resource_id             = aws_api_gateway_resource.order.id
  http_method             = aws_api_gateway_method.get_order.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_order.invoke_arn
}

resource "aws_api_gateway_method" "cancel_order" {
  rest_api_id   = aws_api_gateway_rest_api.orders.id
  resource_id   = aws_api_gateway_resource.order.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "cancel_order" {
  rest_api_id             = aws_api_gateway_rest_api.orders.id
  resource_id             = aws_api_gateway_resource.order.id
  http_method             = aws_api_gateway_method.cancel_order.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.cancel_order.invoke_arn
}

# The HTTP API: GET /orders.
resource "aws_apigatewayv2_api" "orders" {
  name          = "${var.stage}-orders"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "list_orders" {
  api_id                 = aws_apigatewayv2_api.orders.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_orders" {
  api_id    = aws_apigatewayv2_api.orders.id
  route_key = "GET /orders"
  target    = "integrations/${aws_apigatewayv2_integration.list_orders.id}"
}

# A function URL for receipts, in front of nothing else.
resource "aws_lambda_function_url" "receipt" {
  function_name      = aws_lambda_function.receipt.function_name
  authorization_type = "NONE"
}

# The live orders socket: a client connects, then sends `subscribe`.
resource "aws_apigatewayv2_api" "live" {
  name                       = "${var.stage}-orders-websockets"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "live" {
  api_id           = aws_apigatewayv2_api.live.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.live_socket.invoke_arn
}

resource "aws_apigatewayv2_route" "live_connect" {
  api_id    = aws_apigatewayv2_api.live.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.live.id}"
}

resource "aws_apigatewayv2_route" "live_subscribe" {
  api_id    = aws_apigatewayv2_api.live.id
  route_key = "subscribe"
  target    = "integrations/${aws_apigatewayv2_integration.live.id}"
}
