# /v1/loans and /v1/loans/{loanId}, hung from the platform's /v1.
resource "aws_api_gateway_resource" "loans" {
  rest_api_id = local.rest_api_id
  parent_id   = data.terraform_remote_state.platform.outputs.v1_resource_id
  path_part   = "loans"
}

resource "aws_api_gateway_resource" "loan" {
  rest_api_id = local.rest_api_id
  parent_id   = aws_api_gateway_resource.loans.id
  path_part   = "{loanId}"
}

resource "aws_api_gateway_method" "create_loan" {
  rest_api_id   = local.rest_api_id
  resource_id   = aws_api_gateway_resource.loans.id
  http_method   = "POST"
  authorization = "AWS_IAM"
}

resource "aws_api_gateway_integration" "create_loan" {
  rest_api_id             = local.rest_api_id
  resource_id             = aws_api_gateway_resource.loans.id
  http_method             = aws_api_gateway_method.create_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.create_loan.invoke_arn
}

resource "aws_api_gateway_method" "get_loan" {
  rest_api_id   = local.rest_api_id
  resource_id   = aws_api_gateway_resource.loan.id
  http_method   = "GET"
  authorization = "AWS_IAM"
}

resource "aws_api_gateway_integration" "get_loan" {
  rest_api_id             = local.rest_api_id
  resource_id             = aws_api_gateway_resource.loan.id
  http_method             = aws_api_gateway_method.get_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_loan.invoke_arn
}
