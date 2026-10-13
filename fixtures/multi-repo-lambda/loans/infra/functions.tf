locals {
  functions = {
    create_loan         = "create-loan"
    get_loan            = "get-loan"
    list_borrower_loans = "list-borrower-loans"
  }
}

data "archive_file" "function" {
  for_each = local.functions

  type        = "zip"
  source_dir  = "${path.module}/../functions/${each.value}"
  output_path = "${path.module}/build/${each.value}.zip"
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-loans-lambda"
  assume_role_policy = file("${path.module}/policies/lambda-trust.json")
}

resource "aws_lambda_function" "create_loan" {
  function_name = "${var.name_prefix}-create-loan"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = data.archive_file.function["create_loan"].output_path
}

resource "aws_lambda_function" "get_loan" {
  function_name = "${var.name_prefix}-get-loan"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = data.archive_file.function["get_loan"].output_path
}

resource "aws_lambda_function" "list_borrower_loans" {
  function_name = "${var.name_prefix}-list-borrower-loans"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = data.archive_file.function["list_borrower_loans"].output_path
}
