# The library's one public API. The services hang their own resources from /v1,
# which this repository publishes twice: as an output of its state, and as a
# parameter for deployments that do not read state.
resource "aws_api_gateway_rest_api" "library" {
  name        = "lending-library"
  description = "Every public route of the lending library."
}

resource "aws_api_gateway_resource" "v1" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_rest_api.library.root_resource_id
  path_part   = "v1"
}

resource "aws_ssm_parameter" "api_id" {
  name  = "/lending-library/api/id"
  type  = "String"
  value = aws_api_gateway_rest_api.library.id
}

resource "aws_ssm_parameter" "v1_resource_id" {
  name  = "/lending-library/api/v1-resource-id"
  type  = "String"
  value = aws_api_gateway_resource.v1.id
}

# /v1/borrowers/{borrowerId}/loans is the platform's own route, answered by a
# function the loans service deploys and this repository knows only by name.
resource "aws_api_gateway_resource" "borrowers" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "borrowers"
}

resource "aws_api_gateway_resource" "borrower" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_resource.borrowers.id
  path_part   = "{borrowerId}"
}

resource "aws_api_gateway_resource" "borrower_loans" {
  rest_api_id = aws_api_gateway_rest_api.library.id
  parent_id   = aws_api_gateway_resource.borrower.id
  path_part   = "loans"
}

data "aws_lambda_function" "list_borrower_loans" {
  function_name = "library-${var.stage}-list-borrower-loans"
}

resource "aws_api_gateway_method" "list_borrower_loans" {
  rest_api_id   = aws_api_gateway_rest_api.library.id
  resource_id   = aws_api_gateway_resource.borrower_loans.id
  http_method   = "GET"
  authorization = "AWS_IAM"
}

resource "aws_api_gateway_integration" "list_borrower_loans" {
  rest_api_id             = aws_api_gateway_rest_api.library.id
  resource_id             = aws_api_gateway_resource.borrower_loans.id
  http_method             = aws_api_gateway_method.list_borrower_loans.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = data.aws_lambda_function.list_borrower_loans.invoke_arn
}
