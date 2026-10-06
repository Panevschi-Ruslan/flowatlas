# start-workflow-function-helper

A lending library's loans service whose handlers start the approval workflow
and invoke a function through helpers written as functions of a module, not
methods of a class: `export const startWorkflow = async (stateMachineArn, input)
=> …` and `export async function notifyFunction(functionName, event)`. Each
hands the name it was given to the AWS SDK, so the name is decided by whoever
calls it (R175).

Synthetic, in the shape of the aws-samples serverless projects. Type-checked
against the stubs in `node_modules`, never executed or deployed.

## What each call is read as

| Call | Read as |
|---|---|
| `startWorkflow(process.env.LOAN_APPROVAL_ARN, loan)` in `create-loan`, imported by name | `start lending-loan-approval`, drawn at this call, `static`: the helper's parameter is followed out to its caller, and the variable is completed from the function's Terraform |
| `functions.notifyFunction('lending-notify-borrower', …)` in `create-loan`, through the module's namespace | `invoke-async lending-notify-borrower`, drawn at this call. The call into `notifyFunction` is drawn too: a member of a namespace import is the function its module declares |
| `start('lending-loan-approval', …)` in `renew-loan`, the helper imported under another name | `start lending-loan-approval`, drawn at this call |

## Before

Forwarding followed a parameter out of a method only. Each start was drawn
inside its helper as `start ?` with a `start-name-unread` row, the flow from
`POST /loans` stopped at the helper, and `functions.notifyFunction(…)` was a
`call-dynamic-receiver` row with no call drawn.

## Asked of it

`expected.cli/` holds `flow` for `POST /loans` and for the renewal, and
`doctor`, which has nothing to report.
