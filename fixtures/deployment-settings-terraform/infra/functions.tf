# Four workers reading a queue each, and the function the fulfilment workflow invokes.

resource "aws_lambda_function" "ship_order" {
  function_name = "${var.prefix}-ship-order"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/ship-order.handler"
  filename      = data.archive_file.handlers.output_path
  timeout       = 60
}

resource "aws_lambda_function" "bill_order" {
  function_name = "${var.prefix}-bill-order"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/bill-order.handler"
  filename      = data.archive_file.handlers.output_path
  timeout       = 20
}

resource "aws_lambda_function" "pack_order" {
  function_name = "${var.prefix}-pack-order"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/pack-order.handler"
  filename      = data.archive_file.handlers.output_path
  timeout       = 30
}

# No timeout written: the platform's 3 seconds.
resource "aws_lambda_function" "send_notice" {
  function_name = "${var.prefix}-send-notice"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/send-notice.handler"
  filename      = data.archive_file.handlers.output_path
}

resource "aws_lambda_function" "reserve_stock" {
  function_name = "${var.prefix}-reserve-stock"
  role          = local.role_arn
  runtime       = "nodejs20.x"
  handler       = "handlers/reserve-stock.handler"
  filename      = data.archive_file.handlers.output_path
}
