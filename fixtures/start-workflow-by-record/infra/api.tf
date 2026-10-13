resource "aws_api_gateway_rest_api" "loans" {
  name = "${var.prefix}-loans"
}

# /loans
resource "aws_api_gateway_resource" "loans" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_rest_api.loans.root_resource_id
  path_part   = "loans"
}

# /runs/{runId}/resume
resource "aws_api_gateway_resource" "runs" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_rest_api.loans.root_resource_id
  path_part   = "runs"
}

resource "aws_api_gateway_resource" "run" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_resource.runs.id
  path_part   = "{runId}"
}

resource "aws_api_gateway_resource" "resume" {
  rest_api_id = aws_api_gateway_rest_api.loans.id
  parent_id   = aws_api_gateway_resource.run.id
  path_part   = "resume"
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

resource "aws_api_gateway_method" "resume_run" {
  rest_api_id   = aws_api_gateway_rest_api.loans.id
  resource_id   = aws_api_gateway_resource.resume.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "resume_run" {
  rest_api_id             = aws_api_gateway_rest_api.loans.id
  resource_id             = aws_api_gateway_resource.resume.id
  http_method             = aws_api_gateway_method.resume_run.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.resume_run.invoke_arn
}
