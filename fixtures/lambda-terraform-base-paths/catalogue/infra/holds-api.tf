# An HTTP API on the same domain, mapped at `holds`: `POST /requests` is called
# as `https://api.library.example/holds/requests`.
resource "aws_apigatewayv2_api" "holds" {
  name          = "library-holds"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "place_hold" {
  api_id                 = aws_apigatewayv2_api.holds.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.place_hold.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "place_hold" {
  api_id    = aws_apigatewayv2_api.holds.id
  route_key = "POST /requests"
  target    = "integrations/${aws_apigatewayv2_integration.place_hold.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.holds.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_domain_name" "library" {
  domain_name = "api.library.example"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.library.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "holds" {
  api_id          = aws_apigatewayv2_api.holds.id
  domain_name     = aws_apigatewayv2_domain_name.library.id
  stage           = aws_apigatewayv2_stage.default.id
  api_mapping_key = "holds"
}
