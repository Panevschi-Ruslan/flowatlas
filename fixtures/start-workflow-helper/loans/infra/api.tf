resource "aws_api_gateway_rest_api" "loans" {
  name = "${var.prefix}-loans"
}

# /loans
resource "aws_api_gateway_resource" "loans" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_rest_api.loans.root_resource_id
  path_part   = "loans"
}

# /loans/{loanId}/renewals
resource "aws_api_gateway_resource" "loan" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_resource.loans.id
  path_part   = "{loanId}"
}

resource "aws_api_gateway_resource" "renewals" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_resource.loan.id
  path_part   = "renewals"
}

resource "aws_api_gateway_method" "create_loan" {
  rest_api_id   = aws_api_gateway_rest_api.loans.id
  resource_id   = aws_api_gateway_resource.loans.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_loan" {
  rest_api_id             = aws_api_gateway_rest_api.loans.id
  resource_id             = aws_api_gateway_resource.loans.id
  http_method             = aws_api_gateway_method.create_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.create_loan.invoke_arn
}

resource "aws_api_gateway_method" "renew_loan" {
  rest_api_id   = aws_api_gateway_rest_api.loans.id
  resource_id   = aws_api_gateway_resource.renewals.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "renew_loan" {
  rest_api_id             = aws_api_gateway_rest_api.loans.id
  resource_id             = aws_api_gateway_resource.renewals.id
  http_method             = aws_api_gateway_method.renew_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.renew_loan.invoke_arn
}
