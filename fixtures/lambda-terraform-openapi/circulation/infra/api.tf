# The circulation API is created from its OpenAPI document. Each function is
# handed over as a template variable; the region is text the files settle, the
# account is not, and neither matters to which function or queue is named.
resource "aws_api_gateway_rest_api" "circulation" {
  name = "library-circulation"

  body = templatefile("${path.module}/openapi.yaml", {
    region                 = var.region
    account_id             = data.aws_caller_identity.current.account_id
    create_loan_invoke_arn = aws_lambda_function.create_loan.invoke_arn
    get_loan_invoke_arn    = aws_lambda_function.get_loan.invoke_arn
    renew_loan_arn         = aws_lambda_function.renew_loan.arn
    returns_queue          = aws_sqs_queue.returns.name
    api_role_arn           = aws_iam_role.api.arn
    librarians_pool_arn    = aws_cognito_user_pool.librarians.arn
  })
}

resource "aws_api_gateway_deployment" "circulation" {
  rest_api_id = aws_api_gateway_rest_api.circulation.id

  triggers = {
    redeployment = sha1(aws_api_gateway_rest_api.circulation.body)
  }
}

resource "aws_api_gateway_stage" "live" {
  rest_api_id   = aws_api_gateway_rest_api.circulation.id
  deployment_id = aws_api_gateway_deployment.circulation.id
  stage_name    = "live"
}

# The kiosk API's document is built in place: an HTTP API whose hold requests go
# straight onto a queue, and whose catalogue lookup invokes a function.
resource "aws_apigatewayv2_api" "kiosk" {
  name          = "library-kiosk"
  protocol_type = "HTTP"

  body = jsonencode({
    openapi = "3.0.1"
    info    = { title = "library-kiosk", version = "1.0" }
    paths = {
      "/holds" = {
        post = {
          "x-amazon-apigateway-integration" = {
            type                 = "aws_proxy"
            integrationSubtype   = "SQS-SendMessage"
            credentials          = aws_iam_role.api.arn
            payloadFormatVersion = "1.0"
            requestParameters = {
              QueueUrl    = aws_sqs_queue.holds.url
              MessageBody = "$request.body"
            }
          }
        }
      }
      "/items/{itemId}" = {
        get = {
          "x-amazon-apigateway-integration" = {
            type                 = "aws_proxy"
            httpMethod           = "POST"
            uri                  = aws_lambda_function.get_item.invoke_arn
            payloadFormatVersion = "2.0"
          }
        }
      }
    }
  })
}

resource "aws_apigatewayv2_stage" "kiosk" {
  api_id      = aws_apigatewayv2_api.kiosk.id
  name        = "$default"
  auto_deploy = true
}
