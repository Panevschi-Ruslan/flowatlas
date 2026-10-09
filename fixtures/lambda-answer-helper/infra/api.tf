resource "aws_api_gateway_rest_api" "bikes" {
  name        = "${local.prefix}-api"
  description = "Stations and rentals."
}

# /rentals
resource "aws_api_gateway_resource" "rentals" {
  rest_api_id = aws_api_gateway_rest_api.bikes.id
  parent_id   = aws_api_gateway_rest_api.bikes.root_resource_id
  path_part   = "rentals"
}

# /rentals/{rentalId}
resource "aws_api_gateway_resource" "rental" {
  rest_api_id = aws_api_gateway_rest_api.bikes.id
  parent_id   = aws_api_gateway_resource.rentals.id
  path_part   = "{rentalId}"
}

# /rentals/{rentalId}/return
resource "aws_api_gateway_resource" "rental_return" {
  rest_api_id = aws_api_gateway_rest_api.bikes.id
  parent_id   = aws_api_gateway_resource.rental.id
  path_part   = "return"
}

# /stations
resource "aws_api_gateway_resource" "stations" {
  rest_api_id = aws_api_gateway_rest_api.bikes.id
  parent_id   = aws_api_gateway_rest_api.bikes.root_resource_id
  path_part   = "stations"
}

# /stations/{stationId}
resource "aws_api_gateway_resource" "station" {
  rest_api_id = aws_api_gateway_rest_api.bikes.id
  parent_id   = aws_api_gateway_resource.stations.id
  path_part   = "{stationId}"
}

resource "aws_api_gateway_method" "start_rental" {
  rest_api_id   = aws_api_gateway_rest_api.bikes.id
  resource_id   = aws_api_gateway_resource.rentals.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "start_rental" {
  rest_api_id             = aws_api_gateway_rest_api.bikes.id
  resource_id             = aws_api_gateway_resource.rentals.id
  http_method             = aws_api_gateway_method.start_rental.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.start_rental.invoke_arn
}

resource "aws_api_gateway_method" "get_rental" {
  rest_api_id   = aws_api_gateway_rest_api.bikes.id
  resource_id   = aws_api_gateway_resource.rental.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_rental" {
  rest_api_id             = aws_api_gateway_rest_api.bikes.id
  resource_id             = aws_api_gateway_resource.rental.id
  http_method             = aws_api_gateway_method.get_rental.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_rental.invoke_arn
}

resource "aws_api_gateway_method" "end_rental" {
  rest_api_id   = aws_api_gateway_rest_api.bikes.id
  resource_id   = aws_api_gateway_resource.rental_return.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "end_rental" {
  rest_api_id             = aws_api_gateway_rest_api.bikes.id
  resource_id             = aws_api_gateway_resource.rental_return.id
  http_method             = aws_api_gateway_method.end_rental.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.end_rental.invoke_arn
}

resource "aws_api_gateway_method" "list_stations" {
  rest_api_id   = aws_api_gateway_rest_api.bikes.id
  resource_id   = aws_api_gateway_resource.stations.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "list_stations" {
  rest_api_id             = aws_api_gateway_rest_api.bikes.id
  resource_id             = aws_api_gateway_resource.stations.id
  http_method             = aws_api_gateway_method.list_stations.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.list_stations.invoke_arn
}

resource "aws_api_gateway_method" "get_station" {
  rest_api_id   = aws_api_gateway_rest_api.bikes.id
  resource_id   = aws_api_gateway_resource.station.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_station" {
  rest_api_id             = aws_api_gateway_rest_api.bikes.id
  resource_id             = aws_api_gateway_resource.station.id
  http_method             = aws_api_gateway_method.get_station.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_station.invoke_arn
}
