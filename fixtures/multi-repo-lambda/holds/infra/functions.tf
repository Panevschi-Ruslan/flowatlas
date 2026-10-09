data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/handlers"
  output_path = "${path.module}/build/handlers.zip"
}

resource "aws_lambda_function" "place_hold" {
  function_name = "${var.name_prefix}-place-hold"
  role          = "arn:aws:iam::000000000000:role/library-holds"
  runtime       = "nodejs20.x"
  handler       = "place-hold.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "cancel_hold" {
  function_name = "${var.name_prefix}-cancel-hold"
  role          = "arn:aws:iam::000000000000:role/library-holds"
  runtime       = "nodejs20.x"
  handler       = "cancel-hold.handler"
  filename      = data.archive_file.handlers.output_path
}
