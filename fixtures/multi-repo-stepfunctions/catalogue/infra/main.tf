terraform {
  required_version = ">= 1.5"
}

provider "aws" {
  region = "eu-west-1"
}

data "archive_file" "handlers" {
  type        = "zip"
  source_dir  = "${path.module}/../src/handlers"
  output_path = "${path.module}/build/handlers.zip"
}

# Invoked by the checkout workflow in `circulation`, by its name.
resource "aws_lambda_function" "reserve_copy" {
  function_name = "catalogue-reserve-copy"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "reserve-copy.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "reshelve" {
  function_name = "catalogue-reshelve"
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = "reshelve.handler"
  filename      = data.archive_file.handlers.output_path
}

# The returns workflow is deployed by the library's operations team from
# `workflows/reshelve-returns.asl.json`; nothing here deploys it.
