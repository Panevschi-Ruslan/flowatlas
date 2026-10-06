# The librarians' REST API, with its routes declared through a module the
# platform team keeps in another repository and the configuration describes.
resource "aws_api_gateway_rest_api" "admin" {
  name = "catalogue-admin"
}

resource "aws_api_gateway_resource" "borrowers" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "borrowers"
}

module "get_borrower_route" {
  source = "git::https://git.example.com/library-platform/terraform-api-route.git?ref=v2.1.0"

  rest_api_id        = aws_api_gateway_rest_api.admin.id
  parent_resource_id = aws_api_gateway_resource.borrowers.id
  path_part          = "{borrowerId}"
  http_method        = "GET"
  lambda_invoke_arn  = module.get_borrower.lambda_function_invoke_arn
}
