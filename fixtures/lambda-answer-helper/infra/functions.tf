data "archive_file" "rentals" {
  type        = "zip"
  source_dir  = "${path.module}/../src/rentals"
  output_path = "${path.module}/build/rentals.zip"
}

data "archive_file" "stations" {
  type        = "zip"
  source_dir  = "${path.module}/../src/stations"
  output_path = "${path.module}/build/stations.zip"
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

resource "aws_lambda_function" "start_rental" {
  function_name    = "${local.prefix}-start-rental"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "start-rental.handler"
  filename         = data.archive_file.rentals.output_path
  source_code_hash = data.archive_file.rentals.output_base64sha256
}

resource "aws_lambda_function" "get_rental" {
  function_name    = "${local.prefix}-get-rental"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-rental.handler"
  filename         = data.archive_file.rentals.output_path
  source_code_hash = data.archive_file.rentals.output_base64sha256
}

resource "aws_lambda_function" "end_rental" {
  function_name    = "${local.prefix}-end-rental"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "end-rental.handler"
  filename         = data.archive_file.rentals.output_path
  source_code_hash = data.archive_file.rentals.output_base64sha256
}

resource "aws_lambda_function" "list_stations" {
  function_name    = "${local.prefix}-list-stations"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "list-stations.handler"
  filename         = data.archive_file.stations.output_path
  source_code_hash = data.archive_file.stations.output_base64sha256
}

resource "aws_lambda_function" "get_station" {
  function_name    = "${local.prefix}-get-station"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "get-station.handler"
  filename         = data.archive_file.stations.output_path
  source_code_hash = data.archive_file.stations.output_base64sha256
}
