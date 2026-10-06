# /v1/holds and /v1/holds/{holdId}, hung from the platform's /v1.
resource "aws_api_gateway_resource" "holds" {
  rest_api_id = nonsensitive(data.aws_ssm_parameter.api_id.value)
  parent_id   = nonsensitive(data.aws_ssm_parameter.v1_resource_id.value)
  path_part   = "holds"
}

resource "aws_api_gateway_resource" "hold" {
  rest_api_id = nonsensitive(data.aws_ssm_parameter.api_id.value)
  parent_id   = aws_api_gateway_resource.holds.id
  path_part   = "{holdId}"
}

resource "aws_api_gateway_method" "place_hold" {
  rest_api_id   = nonsensitive(data.aws_ssm_parameter.api_id.value)
  resource_id   = aws_api_gateway_resource.holds.id
  http_method   = "POST"
  authorization = "AWS_IAM"
}

resource "aws_api_gateway_integration" "place_hold" {
  rest_api_id             = nonsensitive(data.aws_ssm_parameter.api_id.value)
  resource_id             = aws_api_gateway_resource.holds.id
  http_method             = "POST"
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.place_hold.invoke_arn
}

resource "aws_api_gateway_method" "cancel_hold" {
  rest_api_id   = nonsensitive(data.aws_ssm_parameter.api_id.value)
  resource_id   = aws_api_gateway_resource.hold.id
  http_method   = "DELETE"
  authorization = "AWS_IAM"
}

resource "aws_api_gateway_integration" "cancel_hold" {
  rest_api_id             = nonsensitive(data.aws_ssm_parameter.api_id.value)
  resource_id             = aws_api_gateway_resource.hold.id
  http_method             = "DELETE"
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.cancel_hold.invoke_arn
}
