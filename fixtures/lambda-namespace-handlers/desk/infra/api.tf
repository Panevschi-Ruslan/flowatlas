resource "aws_api_gateway_rest_api" "desk" {
  name = "${local.prefix}-api"
}

# /loans

resource "aws_api_gateway_resource" "loans" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_rest_api.desk.root_resource_id
  path_part   = "loans"
}

resource "aws_api_gateway_method" "create_loan" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.loans.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_loan" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.loans.id
  http_method             = aws_api_gateway_method.create_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.create_loan.invoke_arn
}

resource "aws_api_gateway_resource" "loan" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_resource.loans.id
  path_part   = "{loanId}"
}

resource "aws_api_gateway_resource" "renewals" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_resource.loan.id
  path_part   = "renewals"
}

resource "aws_api_gateway_method" "renew_loan" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.renewals.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "renew_loan" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.renewals.id
  http_method             = aws_api_gateway_method.renew_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.renew_loan.invoke_arn
}

# /holds

resource "aws_api_gateway_resource" "holds" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_rest_api.desk.root_resource_id
  path_part   = "holds"
}

resource "aws_api_gateway_method" "place_hold" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.holds.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "place_hold" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.holds.id
  http_method             = aws_api_gateway_method.place_hold.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.place_hold.invoke_arn
}

resource "aws_api_gateway_resource" "hold" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_resource.holds.id
  path_part   = "{holdId}"
}

resource "aws_api_gateway_method" "cancel_hold" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.hold.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "cancel_hold" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.hold.id
  http_method             = aws_api_gateway_method.cancel_hold.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.cancel_hold.invoke_arn
}

# /returns

resource "aws_api_gateway_resource" "returns" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_rest_api.desk.root_resource_id
  path_part   = "returns"
}

resource "aws_api_gateway_method" "record_return" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.returns.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "record_return" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.returns.id
  http_method             = aws_api_gateway_method.record_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.record_return.invoke_arn
}

# /loans/{loanId}/archive, straight onto the function whose handler is built by
# a package that is not installed: nothing past the function's entry is read.

resource "aws_api_gateway_resource" "archive" {
  rest_api_id = aws_api_gateway_rest_api.desk.id
  parent_id   = aws_api_gateway_resource.loan.id
  path_part   = "archive"
}

resource "aws_api_gateway_method" "archive_loan" {
  rest_api_id   = aws_api_gateway_rest_api.desk.id
  resource_id   = aws_api_gateway_resource.archive.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "archive_loan" {
  rest_api_id             = aws_api_gateway_rest_api.desk.id
  resource_id             = aws_api_gateway_resource.archive.id
  http_method             = aws_api_gateway_method.archive_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.archive_loan.invoke_arn
}
