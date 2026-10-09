# The public catalogue, as an HTTP API through the public module.
module "http_api" {
  source  = "terraform-aws-modules/apigateway-v2/aws"
  version = "~> 5.0"

  name          = "catalogue"
  protocol_type = "HTTP"

  routes = {
    "GET /titles/{isbn}" = {
      integration = {
        uri = module.get_title.invoke_arn
      }
    }

    "GET /titles" = {
      integration = {
        uri                    = module.search_titles.lambda_function_arn
        payload_format_version = "2.0"
      }
    }

    "POST /borrowers" = {
      authorization_type = "AWS_IAM"
      integration = {
        uri = module.register_borrower.lambda_function_arn
      }
    }
  }
}
