# The orders table; its stream runs `order-changed`.
resource "aws_dynamodb_table" "orders" {
  name             = "${local.prefix}-orders"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "orderId"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "orderId"
    type = "S"
  }
}

resource "aws_lambda_event_source_mapping" "order_changed" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = aws_lambda_function.order_changed.arn
  starting_position = "LATEST"
}

# Invoices: every `.pdf` created under `invoices/` is indexed.
resource "aws_s3_bucket" "invoices" {
  bucket = "${local.prefix}-invoices"
}

resource "aws_s3_bucket_notification" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.index_invoice.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "invoices/"
    filter_suffix       = ".pdf"
  }
}
