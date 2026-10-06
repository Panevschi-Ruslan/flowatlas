# A WebSocket API: no paths and no verbs. A message goes to the route its
# `action` names, and the connection opening and closing are routes too.
resource "aws_apigatewayv2_api" "reading_room" {
  name                       = "library-reading-room"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_authorizer" "borrowers" {
  api_id           = aws_apigatewayv2_api.reading_room.id
  authorizer_type  = "REQUEST"
  name             = "borrowers"
  identity_sources = ["route.request.querystring.token"]
  authorizer_uri   = aws_lambda_function.route["connect"].invoke_arn
}

resource "aws_apigatewayv2_integration" "route" {
  for_each = local.handlers

  api_id           = aws_apigatewayv2_api.reading_room.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.route[each.key].invoke_arn
}

resource "aws_apigatewayv2_route" "connect" {
  api_id             = aws_apigatewayv2_api.reading_room.id
  route_key          = "$connect"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.borrowers.id
  target             = "integrations/${aws_apigatewayv2_integration.route["connect"].id}"
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.reading_room.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.route["disconnect"].id}"
}

resource "aws_apigatewayv2_route" "ask_librarian" {
  api_id    = aws_apigatewayv2_api.reading_room.id
  route_key = "askLibrarian"
  target    = "integrations/${aws_apigatewayv2_integration.route["ask"].id}"
}

resource "aws_apigatewayv2_route" "fallback" {
  api_id    = aws_apigatewayv2_api.reading_room.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.route["fallback"].id}"
}

resource "aws_apigatewayv2_stage" "live" {
  api_id      = aws_apigatewayv2_api.reading_room.id
  name        = "live"
  auto_deploy = true
}
