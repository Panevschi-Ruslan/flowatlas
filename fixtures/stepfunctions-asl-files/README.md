# stepfunctions-asl-files

Three state machine definitions kept as files beside the code that runs with
them, in two repositories, and one workflow that starts a workflow in the other.

This is the fixture for the half of P22 that needs no deployment reader: a
definition written in the Amazon States Language, read on its own, drawn as a
`workflow` entry whose states are steps. The shape is the one public serverless
samples use - a `statemachine/` or `workflows/` directory of `*.asl.json` and
`*.asl.yaml` files next to the functions - in a lending library, a domain chosen
to be unrelated to any project the tool was tried on.

Read, never executed. Both repositories are Express services, which is what
puts them in front of a server reader; `node_modules/express` in each is the
same hand-written stub `express-service` uses.

## The workflows

| File | Workflow | Written in |
|---|---|---|
| `circulation/statemachine/loan-approval.asl.json` | `loan-approval` | JSON, JSONPath |
| `notifications/workflows/borrower-notifications.asl.yaml` | `borrower-notifications` | YAML, JSONPath |
| `notifications/workflows/overdue-reminders.asl.json` | `overdue-reminders` | JSON, JSONata |

Each is named after its file and says so (`workflow-named-by-file`): a
definition on its own carries no deployed name. The one join made on such a
name - `NotifyBorrower` starting `borrower-notifications` across the two
repositories - is therefore `heuristic`, not `static`.

## What each step is drawn as

`loan-approval` holds every type of state and every way control moves.

| State | Type | Drawn as |
|---|---|---|
| `ShapeApplication` | Pass | a step |
| `CheckBorrowerStanding` | Task, `lambda:invoke`, a plain name | a reference to `invoke:check-borrower-standing`; a `Retry` on the node; a `catch` edge to `RejectLoan` |
| `IsBorrowerInGoodStanding` | Choice | two `choice` edges and a `default`; the rule and the default that both go to `RejectLoan` are one edge listing both |
| `CheckHolds` | Task, `aws-sdk:dynamodb:query` | a `db_query` reading `library-holds` |
| `ReserveCopies` / `ReserveCopy` | Map with an `ItemProcessor` | an `item-processor` edge; a `db_query` writing `library-copies` |
| `AwaitLibrarianApproval` | Task, `sqs:sendMessage.waitForTaskToken` | an informational row naming the queue `librarian-approvals` |
| `RecordLoan` / `WriteLoan` / `ScoreBorrower` | Parallel | a `branch` edge per branch; `ScoreBorrower` names its function by ARN as the `Resource`, with an alias |
| `NotifyBorrower` | Task, `states:startExecution.sync:2` | joined to `workflow:borrower-notifications` in `notifications` |
| `PublishLoanApproved` | Task, `events:putEvents` | an informational row naming the bus, the source and the detail type |
| `ArchiveApplication` | Task, `aws-sdk:s3:putObject` | a step that says the service and the action, and joins nothing |
| `LookUpBranchPolicy` | Task, `FunctionName.$` | `workflow-target-dynamic`: chosen at run time, no edge |
| `ApplyLateFeePolicy` | Task, `${LateFeePolicyFunctionArn}` | `workflow-template-unbound`: a placeholder nothing here fills, no edge |
| `WaitForPickupWindow`, `LoanApproved`, `RejectLoan`, `LoanRejected` | Wait, Succeed, Task `sns:publish`, Fail | steps; the topic is an informational row |

`borrower-notifications` names its two functions by a full ARN and by a partial
one. `overdue-reminders` is written in JSONata, uses the older `Iterator` name
for its map, and chooses its reminder function with an expression.

## What is not joined yet, and says so

Every task that invokes a function is a `reference-not-found` row here: a
function becomes an entry with a deployed name only once the deployment that
creates it is read (P21). The references are in the graph already, so the day
that reader lands these rows become edges with nothing in this fixture changed.
Queues, topics and buses are recorded on their steps until their subscribers are
read (P23).

## Asked of it

`expected.cli/` holds `flow workflow:loan-approval`, which walks every state in
order and across into `notifications`, `impact` on a step of the second
workflow, which reaches back up through both, and `doctor`.
