# stepfunctions-terraform

Four state machines deployed with Terraform over the Lambda functions of one
lending library, each with its definition written a different way. This is the
fixture for the half of P22 that reads a definition from the deployment that
creates it: the workflow is named by what it is deployed as, and a task that
names a function through a Terraform reference joins that function's `invoke`
entry at `static`.

Synthetic, in the shape the public serverless samples use: handlers under
`src/handlers`, Terraform under `infra`, definitions under `statemachine`.
Type-checked, never executed or deployed.

## The workflows

| Deployed as | Declared as | Definition written as |
|---|---|---|
| `lending-loan-approval` | `aws_sfn_state_machine.loan_approval` | `file("${path.module}/../statemachine/loan-approval.asl.json")`, names written in place |
| `lending-loan-renewal` | `module.loan_renewal`, the public `terraform-aws-modules/step-functions/aws` | `templatefile(...)`, handed function ARNs, a table name and the ARN of `lending-loan-approval` |
| `lending-overdue-sweep` | `module.overdue_sweep`, the repository's own `./modules/workflow` | `jsonencode({ ... })`, with a function's ARN as a `Resource` |
| `lending-hold-expiry` | `aws_sfn_state_machine.hold_expiry` | a heredoc, with a function's ARN and a table name interpolated |

Every name is `"${var.prefix}-..."`, evaluated: the workflow is
`lending-loan-approval`, not `loan-approval` after its file.

`loan-approval.asl.json` and `loan-renewal.asl.json` are also named like
standalone definitions. Each is read once, by the deployment that loads it,
under the name it is deployed with; neither is a second, file-named workflow.

## What each workflow shows

- **`lending-loan-approval`**: `Choice`, a `Map` item processor writing a
  table, a `.waitForTaskToken` send to a queue (an informational row until the
  queue's consumer is read), a `Parallel` whose second branch names its
  function by ARN as the `Resource`, and a `Catch` written above its `Next`.
  `flow` walks the `Next` first and the `Catch` after it.
- **`lending-loan-renewal`**: every function it invokes is a template variable
  holding a Terraform reference - `aws_lambda_function.check_borrower.arn`,
  `module.assess_late_fee.lambda_function_arn` through the described lambda
  module - and each joins the function at `static`. `AwaitFeePayment` invokes a
  function with `.waitForTaskToken`. `ReapproveFlaggedLoans` starts
  `lending-loan-approval` by the ARN it is handed. `branch_policy_arn` is
  handed `var.branch_policy_function_arn`, which nothing sets: the step that
  uses it is one `workflow-template-unbound` row, and no edge.
- **`lending-overdue-sweep`**: a definition built in place, through a local
  module that hands `var.definition` on; each state is placed on the line of
  `workflows.tf` it is written on.
- **`lending-hold-expiry`**: a heredoc, placed on the lines of `workflows.tf`
  it occupies.

## Asked of it

`expected.cli/` holds `flow` for the workflow loaded with `file()` and for the
one rendered with `templatefile()`, both without `--depth` - the default walks
every step of a workflow and on into each handler - `impact` on the handler two
workflows invoke, and `doctor`.
