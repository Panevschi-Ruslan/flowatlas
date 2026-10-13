# Four state machines, each with its definition written a different way.

# 1. Loaded as it is with file(). The definition names its functions literally,
#    and the file is also a standalone `*.asl.json`: it is read once, here,
#    under the name it is deployed with.
resource "aws_sfn_state_machine" "loan_approval" {
  name       = "${var.prefix}-loan-approval"
  role_arn   = local.role_arn
  definition = file("${path.module}/../statemachine/loan-approval.asl.json")
}

# 2. Rendered with templatefile(), handed the ARNs of the functions it invokes,
#    the name of a table and the ARN of the first workflow, through the public
#    module, which ships described.
module "loan_renewal" {
  source  = "terraform-aws-modules/step-functions/aws"
  version = "~> 4.0"

  name     = "${var.prefix}-loan-renewal"
  role_arn = local.role_arn

  definition = templatefile("${path.module}/../statemachine/loan-renewal.asl.json", {
    check_borrower_arn  = aws_lambda_function.check_borrower.arn
    assess_late_fee_arn = module.assess_late_fee.lambda_function_arn
    notify_borrower_arn = aws_lambda_function.notify_borrower.arn
    loan_approval_arn   = aws_sfn_state_machine.loan_approval.arn
    branch_policy_arn   = var.branch_policy_function_arn
    loans_table         = aws_dynamodb_table.loans.name
  })
}

# 3. Built in place with jsonencode(), through the repository's own module.
module "overdue_sweep" {
  source = "./modules/workflow"

  name = "${var.prefix}-overdue-sweep"

  definition = jsonencode({
    Comment = "Finds the loans past their return date and reminds each borrower."
    StartAt = "FindOverdueLoans"
    States = {
      FindOverdueLoans = {
        Type     = "Task"
        Resource = "arn:aws:states:::aws-sdk:dynamodb:scan"
        Parameters = {
          TableName        = aws_dynamodb_table.loans.name
          FilterExpression = "dueDate < :today"
          ExpressionAttributeValues = {
            ":today" = { "S.$" = "$.today" }
          }
        }
        ResultPath = "$.overdue"
        Next       = "RemindBorrowers"
      }
      RemindBorrowers = {
        Type      = "Map"
        ItemsPath = "$.overdue.Items"
        ItemProcessor = {
          ProcessorConfig = { Mode = "INLINE" }
          StartAt         = "SendReminder"
          States = {
            SendReminder = {
              Type     = "Task"
              Resource = aws_lambda_function.send_overdue_reminder.arn
              End      = true
            }
          }
        }
        End = true
      }
    }
  })
}

# 4. Written in place as a heredoc, with the function's ARN interpolated.
resource "aws_sfn_state_machine" "hold_expiry" {
  name     = "${var.prefix}-hold-expiry"
  role_arn = local.role_arn
  type     = "EXPRESS"

  definition = <<EOF
{
  "Comment": "Releases a hold nobody collected and offers the item to the next borrower.",
  "StartAt": "WaitForCollectionWindow",
  "States": {
    "WaitForCollectionWindow": {
      "Type": "Wait",
      "SecondsPath": "$.collectionWindowSeconds",
      "Next": "ReleaseHold"
    },
    "ReleaseHold": {
      "Type": "Task",
      "Resource": "${aws_lambda_function.release_hold.arn}",
      "Next": "ClearHold"
    },
    "ClearHold": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:deleteItem",
      "Parameters": {
        "TableName": "${aws_dynamodb_table.holds.name}",
        "Key": { "holdId": { "S.$": "$.holdId" } }
      },
      "End": true
    }
  }
}
EOF
}
