# The repository's own wrapper around a function: an archive of a source
# directory and the function that runs it.
variable "name" {
  type = string
}

variable "handler" {
  type = string
}

variable "source_dir" {
  type = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

data "archive_file" "this" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/build/${var.name}.zip"
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  role          = "arn:aws:iam::000000000000:role/catalogue"
  runtime       = "nodejs20.x"
  handler       = var.handler
  filename      = data.archive_file.this.output_path

  environment {
    variables = var.environment
  }
}

output "invoke_arn" {
  value = aws_lambda_function.this.invoke_arn
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}
