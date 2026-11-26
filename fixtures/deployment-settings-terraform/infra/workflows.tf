# Fulfilment: its tasks say no timeout, and the state machine says none.
resource "aws_sfn_state_machine" "fulfil_order" {
  name       = "${var.prefix}-fulfil-order"
  role_arn   = local.role_arn
  definition = file("${path.module}/../statemachine/fulfil-order.asl.json")
}

# Returns: the state machine bounds every execution, and its callback beats.
# Nothing to say.
resource "aws_sfn_state_machine" "accept_return" {
  name       = "${var.prefix}-accept-return"
  role_arn   = local.role_arn
  definition = file("${path.module}/../statemachine/accept-return.asl.json")
}
