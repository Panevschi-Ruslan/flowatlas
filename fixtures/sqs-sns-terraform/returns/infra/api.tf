resource "aws_api_gateway_rest_api" "returns" {
  name = "library-returns"
}

resource "aws_api_gateway_resource" "returns" {
  rest_api_id = aws_api_gateway_rest_api.returns.id
  parent_id   = aws_api_gateway_rest_api.returns.root_resource_id
  path_part   = "returns"
}

resource "aws_api_gateway_method" "record_return" {
  rest_api_id   = aws_api_gateway_rest_api.returns.id
  resource_id   = aws_api_gateway_resource.returns.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "record_return" {
  rest_api_id             = aws_api_gateway_rest_api.returns.id
  resource_id             = aws_api_gateway_resource.returns.id
  http_method             = aws_api_gateway_method.record_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.record_return.invoke_arn
}

resource "aws_api_gateway_resource" "bulk" {
  rest_api_id = aws_api_gateway_rest_api.returns.id
  parent_id   = aws_api_gateway_resource.returns.id
  path_part   = "bulk"
}

resource "aws_api_gateway_method" "bulk_return" {
  rest_api_id   = aws_api_gateway_rest_api.returns.id
  resource_id   = aws_api_gateway_resource.bulk.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "bulk_return" {
  rest_api_id             = aws_api_gateway_rest_api.returns.id
  resource_id             = aws_api_gateway_resource.bulk.id
  http_method             = aws_api_gateway_method.bulk_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.bulk_return.invoke_arn
}

# A hold request is sent straight to a queue: the route is the publisher, and
# no function runs until the queue's own reader does.
resource "aws_api_gateway_resource" "holds" {
  rest_api_id = aws_api_gateway_rest_api.returns.id
  parent_id   = aws_api_gateway_rest_api.returns.root_resource_id
  path_part   = "holds"
}

resource "aws_api_gateway_method" "request_hold" {
  rest_api_id   = aws_api_gateway_rest_api.returns.id
  resource_id   = aws_api_gateway_resource.holds.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_iam_role" "api_sqs" {
  name = "${local.prefix}-api-send-message"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_api_gateway_integration" "request_hold" {
  rest_api_id             = aws_api_gateway_rest_api.returns.id
  resource_id             = aws_api_gateway_resource.holds.id
  http_method             = aws_api_gateway_method.request_hold.http_method
  integration_http_method = "POST"
  type                    = "AWS"
  credentials             = aws_iam_role.api_sqs.arn
  uri                     = "arn:aws:apigateway:${var.region}:sqs:path/${data.aws_caller_identity.current.account_id}/${aws_sqs_queue.hold_requests.name}"

  request_parameters = {
    "integration.request.header.Content-Type" = "'application/x-www-form-urlencoded'"
  }

  request_templates = {
    "application/json" = "Action=SendMessage&MessageBody=$input.body"
  }
}
