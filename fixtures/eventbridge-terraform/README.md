# eventbridge-terraform

A lending library's circulation service: Lambda functions behind an HTTP API
that talk to each other over an EventBridge bus. The publishers are SDK calls in
the handlers; the subscribers are rules and targets in `infra/rules.tf`. It
exists to prove that the two halves of each channel meet on one node.

Type-checked, never executed or deployed.

| Publisher | Channel | Subscriber |
|---|---|---|
| `create-loan.ts`, a `PutEventsCommand` built in the call (`POST /loans`) | `eventbridge/library/library.loans/LoanCreated` | rule `library-loan-created`, exact source and detail type: `static`, onto `library-notify-borrower` |
| `renew-loan.ts`, a command built in a local and sent a statement later (`POST /loans/{loanId}/renewals`) | `eventbridge/library/library.loans/LoanRenewed` | rule `library-renewal-review`, `source` by `prefix "library."`: `heuristic`, and the edge says why; its filter on `detail` is recorded (`notMatchedOn`) and not matched on. The target is the state machine `loan-review` |
| `record-return.ts`, through the project's helper `publishLibraryEvent`, described in `flowatlas.config.json` | `eventbridge/library/library.returns/ItemReturned` | rule `library-item-returned`, exact |
| `POST /holds`, an HTTP API route integrated with `EventBridge-PutEvents` itself: no function runs | `eventbridge/library/library.holds/HoldRequested` | rule `library-hold-requested`, exact |
| nothing in this project | `eventbridge/default/aws.s3/Object Created` | rule `library-cover-uploaded` on the default bus: a way in from outside, an entry with no producer and no row |

`library-nightly-overdue` has a `schedule_expression` instead of a pattern: it
is a `cron` entry whose handler is `scan-overdue`'s, the way a route in front of
a function is.

The state machine is defined in `statemachines/loan-review.asl.json` and
deployed by `aws_sfn_state_machine.loan_review` under the name `loan-review`.
The definition is read on its own, so its workflow is named after its file and
the rule's join to it is `heuristic` (`workflow-named-by-file`); once the
definition is read from the Terraform that deploys it, the same join is
`static`. `flow 'POST /loans/:param/renewals' --depth 24` walks from the route,
through `PutEvents` and the rule, into the states and the function the first one
invokes.

The helper's own `send` cannot say which event it puts, so it is the one
`channel-dynamic` row: the description is what reads its callers.
