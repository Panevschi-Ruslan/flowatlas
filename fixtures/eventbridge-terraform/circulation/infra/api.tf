resource "aws_apigatewayv2_api" "circulation" {
  name          = "library-circulation"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create_loan" {
  api_id                 = aws_apigatewayv2_api.circulation.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_loan" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /loans"
  target    = "integrations/${aws_apigatewayv2_integration.create_loan.id}"
}

resource "aws_apigatewayv2_integration" "renew_loan" {
  api_id                 = aws_apigatewayv2_api.circulation.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.renew_loan.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "renew_loan" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /loans/{loanId}/renewals"
  target    = "integrations/${aws_apigatewayv2_integration.renew_loan.id}"
}

resource "aws_apigatewayv2_integration" "record_return" {
  api_id                 = aws_apigatewayv2_api.circulation.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.record_return.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "record_return" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /returns"
  target    = "integrations/${aws_apigatewayv2_integration.record_return.id}"
}

# A hold request goes straight onto the bus: no function runs, and the route
# is the publisher of HoldRequested.
resource "aws_iam_role" "api_events" {
  name = "${local.prefix}-api-put-events"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_apigatewayv2_integration" "request_hold" {
  api_id              = aws_apigatewayv2_api.circulation.id
  integration_type    = "AWS_PROXY"
  integration_subtype = "EventBridge-PutEvents"
  credentials_arn     = aws_iam_role.api_events.arn

  request_parameters = {
    EventBusName = aws_cloudwatch_event_bus.library.name
    Source       = "library.holds"
    DetailType   = "HoldRequested"
    Detail       = "$request.body"
  }
}

resource "aws_apigatewayv2_route" "request_hold" {
  api_id    = aws_apigatewayv2_api.circulation.id
  route_key = "POST /holds"
  target    = "integrations/${aws_apigatewayv2_integration.request_hold.id}"
}
