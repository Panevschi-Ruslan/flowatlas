# Shipping: reserve the stock, then charge for it.
resource "aws_sfn_state_machine" "shipping" {
  name     = "${local.prefix}-shipping"
  role_arn = aws_iam_role.workflow.arn

  definition = templatefile("${path.module}/../statemachine/shipping.asl.json", {
    reserve_stock_arn  = aws_lambda_function.reserve_stock.arn
    charge_payment_arn = aws_lambda_function.charge_payment.arn
  })
}
