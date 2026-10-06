output "rest_api_id" {
  value = aws_api_gateway_rest_api.library.id
}

output "v1_resource_id" {
  value = aws_api_gateway_resource.v1.id
}
