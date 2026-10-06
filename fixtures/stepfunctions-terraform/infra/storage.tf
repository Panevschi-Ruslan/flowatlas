resource "aws_dynamodb_table" "loans" {
  name         = "${var.prefix}-loans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "loanId"

  attribute {
    name = "loanId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "holds" {
  name         = "${var.prefix}-holds"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "holdId"

  attribute {
    name = "holdId"
    type = "S"
  }
}
