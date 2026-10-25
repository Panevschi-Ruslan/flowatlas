# Two HTTP APIs, each answering `GET /status` with a function of its own.
resource "aws_apigatewayv2_api" "loans" {
  name          = "library-loans-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "loans_status" {
  api_id                 = aws_apigatewayv2_api.loans.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.loans_status.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "loans_status" {
  api_id    = aws_apigatewayv2_api.loans.id
  route_key = "GET /status"
  target    = "integrations/${aws_apigatewayv2_integration.loans_status.id}"
}

resource "aws_apigatewayv2_api" "events" {
  name          = "library-events-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "events_status" {
  api_id                 = aws_apigatewayv2_api.events.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.events_status.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "events_status" {
  api_id    = aws_apigatewayv2_api.events.id
  route_key = "GET /status"
  target    = "integrations/${aws_apigatewayv2_integration.events_status.id}"
}
