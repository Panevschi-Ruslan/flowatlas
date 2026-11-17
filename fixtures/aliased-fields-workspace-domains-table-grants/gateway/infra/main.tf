provider "aws" {
  region = "eu-west-1"
}

# The catalogue's domain each workspace maps: the default workspace's is the
# sandbox, the production workspace's is the shop's own.
variable "catalog_domains" {
  type = map(string)
  default = {
    default    = "sandbox.catalog.shop.example.test"
    production = "catalog.shop.example.test"
  }
}

data "archive_file" "orders" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/orders.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-orders-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "orders" {
  function_name = "shop-orders"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "orders.handler"
  filename      = data.archive_file.orders.output_path
}

resource "aws_apigatewayv2_api" "orders" {
  name                         = "shop-orders"
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "orders" {
  api_id                 = aws_apigatewayv2_api.orders.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "orders" {
  api_id    = aws_apigatewayv2_api.orders.id
  route_key = "GET /orders"
  target    = "integrations/${aws_apigatewayv2_integration.orders.id}"
}

# Each workspace has a domain of its own, named after it.
resource "aws_apigatewayv2_domain_name" "orders" {
  domain_name = "${terraform.workspace}.orders.shop.example.test"

  domain_name_configuration {
    certificate_arn = "arn:aws:acm:eu-west-1:111122223333:certificate/shop"
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "orders" {
  api_id          = aws_apigatewayv2_api.orders.id
  domain_name     = aws_apigatewayv2_domain_name.orders.domain_name
  stage           = "$default"
  api_mapping_key = "v1"
}

resource "aws_apigatewayv2_api" "catalog" {
  name                         = "shop-catalog"
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "catalog" {
  api_id                 = aws_apigatewayv2_api.catalog.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.orders.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "products" {
  api_id    = aws_apigatewayv2_api.catalog.id
  route_key = "GET /products"
  target    = "integrations/${aws_apigatewayv2_integration.catalog.id}"
}

# The catalogue's domain is looked up by the workspace.
resource "aws_apigatewayv2_api_mapping" "catalog" {
  api_id      = aws_apigatewayv2_api.catalog.id
  domain_name = lookup(var.catalog_domains, terraform.workspace)
  stage       = "$default"
}
