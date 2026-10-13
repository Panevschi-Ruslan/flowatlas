# A REST API, deployed to the stage `live` and mapped onto the library's domain
# at `v1`. A caller writes `https://api.library.example/v1/items/...`; the stage
# is not part of that address, and is recorded beside the route.
resource "aws_api_gateway_rest_api" "catalogue" {
  name = "library-catalogue"
}

resource "aws_api_gateway_resource" "items" {
  rest_api_id = aws_api_gateway_rest_api.catalogue.id
  parent_id   = aws_api_gateway_rest_api.catalogue.root_resource_id
  path_part   = "items"
}

resource "aws_api_gateway_resource" "item" {
  rest_api_id = aws_api_gateway_rest_api.catalogue.id
  parent_id   = aws_api_gateway_resource.items.id
  path_part   = "{itemId}"
}

resource "aws_api_gateway_method" "get_item" {
  rest_api_id   = aws_api_gateway_rest_api.catalogue.id
  resource_id   = aws_api_gateway_resource.item.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_item" {
  rest_api_id             = aws_api_gateway_rest_api.catalogue.id
  resource_id             = aws_api_gateway_resource.item.id
  http_method             = aws_api_gateway_method.get_item.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_item.invoke_arn
}

resource "aws_api_gateway_deployment" "catalogue" {
  rest_api_id = aws_api_gateway_rest_api.catalogue.id
}

resource "aws_api_gateway_stage" "live" {
  rest_api_id   = aws_api_gateway_rest_api.catalogue.id
  deployment_id = aws_api_gateway_deployment.catalogue.id
  stage_name    = "live"
}

resource "aws_api_gateway_domain_name" "library" {
  domain_name              = "api.library.example"
  regional_certificate_arn = aws_acm_certificate.library.arn

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "catalogue" {
  api_id      = aws_api_gateway_rest_api.catalogue.id
  stage_name  = aws_api_gateway_stage.live.stage_name
  domain_name = aws_api_gateway_domain_name.library.domain_name
  base_path   = "v1"
}
