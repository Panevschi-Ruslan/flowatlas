# The repository's own wrapper around a state machine: a name, a definition,
# and the role every workflow of this library runs as.
variable "name" {
  type = string
}

variable "definition" {
  type = string
}

resource "aws_sfn_state_machine" "this" {
  name       = var.name
  role_arn   = "arn:aws:iam::000000000000:role/lending-workflows"
  definition = var.definition
}

output "arn" {
  value = aws_sfn_state_machine.this.arn
}
