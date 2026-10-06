# start-workflow-sdk

A lending library's loans API, where the handler behind a route starts the
approval workflow and invokes other functions by calling the AWS SDK directly.
This is the fixture for the half of P24 that reads a start written in code: the
call is a producer that reaches the workflow or function deployed under the name
it reads, joined by that name, and `flow 'POST /loans'` walks from the route into
the workflow and on into every function the workflow invokes.

Synthetic, in the shape the public serverless samples use: handlers under
`src/handlers`, Terraform under `infra`, the definition under `statemachine`.
Type-checked, never executed or deployed.

## What each call is read as

| Call | Read as |
|---|---|
| `lambda.send(new InvokeCommand({ FunctionName: 'lending-hold-copies' }))` in `create-loan` | `invoke lending-hold-copies`, joined to that function at `static`; nothing says otherwise, so the caller waits |
| `sfn.send(new StartExecutionCommand({ stateMachineArn: process.env.LOAN_APPROVAL_ARN }))` in `create-loan` | `start lending-loan-approval`, at `static`: the function is deployed with `LOAN_APPROVAL_ARN = aws_sfn_state_machine.loan_approval.arn`, so the linker completes the name the way it completes a queue's, and the `start-from-environment` row the extractor wrote goes |
| `lambda.send(new InvokeCommand({ FunctionName: NOTIFY_BORROWER, InvocationType: 'Event' }))` | `invoke-async lending-notify-borrower`: the function's ARN, read to the name inside it; `Event` makes it an invocation nobody waits for |
| `new AWS.StepFunctions().startExecution({ stateMachineArn }).promise()` in `renew-loan` | `start lending-loan-approval`: version 2, whose class is `StepFunctions` where version 3's is `SFN` |
| `sfn.send(new SendTaskSuccessCommand(...))`, `SendTaskFailureCommand` in `record-review` | `task-success`, `task-failure`: a leaf on the handler and no join. The token names the run that is waiting in `AwaitLibrarianReview`, and no workflow |

No call is read as a channel, because none of them is one: a workflow and a
function each have exactly one receiver, named by the deployment.

## Asked of it

`expected.cli/` holds `flow` for `POST /loans`, through all three starts into
the approval workflow and its three functions, `flow` for `POST /reviews`, and
`doctor`.

`contracts` compares each start's `input` with what the workflow's first state
reads of it: `CheckBorrower` reads `$.borrowerId`. The loan `create-loan` sends
has one; the renewal `renew-loan` sends, `{ loanId, renewal }`, does not, which
fails the run at its first state and is a `missing_required` error. The two
invocations hand over `payloadOf(...)`, bytes made by a helper nothing here sees
into, and are `body-already-serialised`.
