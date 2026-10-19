# Two HTTP APIs whose names come from variables with no value, each answering
# `GET /hours` with a function of its own (P61).
variable "desk_api_name" {
  type = string
}

variable "lab_api_name" {
  type = string
}

resource "aws_apigatewayv2_api" "desk_hours" {
  name          = var.desk_api_name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "desk_hours" {
  api_id                 = aws_apigatewayv2_api.desk_hours.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.desk_hours.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "desk_hours" {
  api_id    = aws_apigatewayv2_api.desk_hours.id
  route_key = "GET /hours"
  target    = "integrations/${aws_apigatewayv2_integration.desk_hours.id}"
}

resource "aws_apigatewayv2_api" "lab_hours" {
  name          = var.lab_api_name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lab_hours" {
  api_id                 = aws_apigatewayv2_api.lab_hours.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.lab_hours.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lab_hours" {
  api_id    = aws_apigatewayv2_api.lab_hours.id
  route_key = "GET /hours"
  target    = "integrations/${aws_apigatewayv2_integration.lab_hours.id}"
}
