provider "aws" {
  region = "eu-west-1"
}

# The shop's REST API, which the orders service hangs its routes from: its id
# and its root resource's are written to parameters of the account, and read
# back there by name.
resource "aws_api_gateway_rest_api" "shop" {
  name = "shop"
}

resource "aws_ssm_parameter" "api_id" {
  name  = "/shop/api/id"
  type  = "String"
  value = aws_api_gateway_rest_api.shop.id
}

resource "aws_ssm_parameter" "api_root" {
  name  = "/shop/api/root-id"
  type  = "String"
  value = aws_api_gateway_rest_api.shop.root_resource_id
}

# The queue orders are placed on, written to two parameters: its address for
# whoever sends to it, its ARN for whoever reads it.
resource "aws_sqs_queue" "placed" {
  name = "shop-orders-placed"
}

resource "aws_ssm_parameter" "placed_url" {
  name  = "/shop/orders/placed-url"
  type  = "String"
  value = aws_sqs_queue.placed.url
}

resource "aws_ssm_parameter" "placed_arn" {
  name  = "/shop/orders/placed-arn"
  type  = "String"
  value = aws_sqs_queue.placed.arn
}

# The catalog's restock topic, which the catalog writes to a parameter; the
# topic has no name of its own.
data "aws_ssm_parameter" "restock_topic" {
  name = "/shop/catalog/restock-topic-arn"
}

data "archive_file" "platform" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/platform.zip"
}

resource "aws_iam_role" "lambda" {
  name = "shop-platform-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "notify" {
  function_name = "shop-platform-notify"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "notify.handler"
  filename      = data.archive_file.platform.output_path
}

resource "aws_sns_topic_subscription" "restocked" {
  topic_arn = data.aws_ssm_parameter.restock_topic.value
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify.arn
}
