variable "function_name" {
  type = string
}

# Any verb, any path, straight to the function.
resource "aws_lambda_function_url" "this" {
  function_name      = var.function_name
  authorization_type = "NONE"
}

output "url" {
  value = aws_lambda_function_url.this.function_url
}
