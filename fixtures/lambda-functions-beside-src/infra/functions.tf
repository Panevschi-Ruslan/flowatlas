# Every function is packaged from functions/, the directory beside src/ that the
# tsconfig does not name. The handlers are bundled there with what they import.

data "archive_file" "functions" {
  type        = "zip"
  source_dir  = "${path.module}/../functions"
  output_path = "${path.module}/build/functions.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "place_hold" {
  function_name    = "${local.prefix}-place-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "place-hold.handler"
  filename         = data.archive_file.functions.output_path
  source_code_hash = data.archive_file.functions.output_base64sha256
}

resource "aws_lambda_function" "cancel_hold" {
  function_name    = "${local.prefix}-cancel-hold"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "cancel-hold.handler"
  filename         = data.archive_file.functions.output_path
  source_code_hash = data.archive_file.functions.output_base64sha256
}

resource "aws_lambda_function" "expire_holds" {
  function_name    = "${local.prefix}-expire-holds"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "expire-holds.handler"
  filename         = data.archive_file.functions.output_path
  source_code_hash = data.archive_file.functions.output_base64sha256
}
