resource "aws_api_gateway_rest_api" "library" {
  name        = "${local.prefix}-api"
  description = "Loans and returns."
}

resource "aws_api_gateway_authorizer" "librarians" {
  name          = "librarians"
  rest_api_id   = aws_api_gateway_rest_api.library.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [var.librarian_pool_arn]
}

variable "librarian_pool_arn" {
  type    = string
  default = "arn:aws:cognito-idp:eu-west-1:000000000000:userpool/eu-west-1_example"
}

# /loans
resource "aws_api_gateway_resource" "loans" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_rest_api.library.root_resource_id
  path_part   = "loans"
}

# /loans/{loanId}
resource "aws_api_gateway_resource" "loan" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_resource.loans.id
  path_part   = "{loanId}"
}

# /loans/{loanId}/renewal
resource "aws_api_gateway_resource" "renewal" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_resource.loan.id
  path_part   = "renewal"
}

# /returns
resource "aws_api_gateway_resource" "returns" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_rest_api.library.root_resource_id
  path_part   = "returns"
}

resource "aws_api_gateway_method" "create_loan" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  resource_id   = aws_api_gateway_resource.loans.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.librarians.id
}

resource "aws_api_gateway_integration" "create_loan" {
  rest_api_id             = aws_api_gateway_rest_api.library.id
  resource_id             = aws_api_gateway_resource.loans.id
  http_method             = aws_api_gateway_method.create_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.create_loan.invoke_arn
}

resource "aws_api_gateway_method" "get_loan" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  resource_id   = aws_api_gateway_resource.loan.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_loan" {
  rest_api_id             = aws_api_gateway_rest_api.library.id
  resource_id             = aws_api_gateway_resource.loan.id
  http_method             = aws_api_gateway_method.get_loan.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_loan.invoke_arn
}

resource "aws_api_gateway_method" "renew_loan" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  resource_id   = aws_api_gateway_resource.renewal.id
  http_method   = "POST"
  authorization = "AWS_IAM"
}

# The older spelling of the same integration: the invoke address written out,
# with the function's ARN in the middle of it.
resource "aws_api_gateway_integration" "renew_loan" {
  rest_api_id             = aws_api_gateway_rest_api.library.id
  resource_id             = aws_api_gateway_resource.renewal.id
  http_method             = "POST"
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:${var.region}:lambda:path/2015-03-31/functions/${aws_lambda_function.renew_loan.arn}/invocations"
}

resource "aws_api_gateway_method" "record_return" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  resource_id   = aws_api_gateway_resource.returns.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.librarians.id
}

resource "aws_api_gateway_integration" "record_return" {
  rest_api_id             = aws_api_gateway_rest_api.library.id
  resource_id             = aws_api_gateway_resource.returns.id
  http_method             = aws_api_gateway_method.record_return.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.record_return.invoke_arn
}

resource "aws_lambda_permission" "api" {
  for_each = {
    create_loan   = aws_lambda_function.create_loan.function_name
    get_loan      = aws_lambda_function.get_loan.function_name
    renew_loan    = aws_lambda_function.renew_loan.function_name
    record_return = aws_lambda_function.record_return.function_name
  }

  statement_id  = "AllowApiGateway-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.library.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "library" {
  rest_api_id = aws_api_gateway_rest_api.library.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.loans.id,
      aws_api_gateway_method.create_loan.id,
      aws_api_gateway_integration.create_loan.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "library" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  deployment_id = aws_api_gateway_deployment.library.id
  stage_name    = var.stage
}
