# multi-repo-stepfunctions

A state machine in one repository that invokes functions two other
repositories deploy, starts a state machine a third deploys, writes a table of
its own, and sends to a queue, a topic and a bus whose subscribers the other
repositories declare: the joins P22 makes across repositories by a deployed
name, and the ones R169 makes between a step that sends and the subscriber P23
reads.

Synthetic, in a lending library. Type-checked, never executed or deployed.

## The repositories

| Service | What it is | What it deploys |
|---|---|---|
| `circulation` | Terraform only, no `package.json` | the workflow `circulation-checkout`, its definition rendered with `templatefile()`; the table `circulation-loans`; the bus `library` and the topic `circulation-checkouts`; a rule starting the checkout on `CheckoutRequested` |
| `members` | handlers and Terraform | the functions `members-check-standing`, `members-send-notice` and `members-record-checkout`; the workflow `members-borrower-notices`, loaded with `file()` through a local from `statemachine/borrower-notices.json`; the route `POST /checkouts`, which puts `CheckoutRequested` on the bus itself |
| `catalogue` | handlers and Terraform | the functions `catalogue-reserve-copy`, `catalogue-reshelve`, `catalogue-pull-copy` and `catalogue-update-availability`; the queue `catalogue-copy-pulls`; `workflows/reshelve-returns.asl.json` is a definition nothing here deploys |

## The joins

`circulation` knows the other two repositories only by name. It looks each up
with a data block - `data.aws_lambda_function.check_standing`,
`data.aws_lambda_function.reserve_copy`,
`data.aws_sfn_state_machine.borrower_notices`, `data.aws_sqs_queue.copy_pulls` -
and hands their ARNs and URLs to the template. Each is filled with the name the
data block names, so:

| Step | Reaches | In | Confidence |
|---|---|---|---|
| `CheckStanding` (`lambda:invoke`, `FunctionName`) | `invoke:members-check-standing` | `members` | `static` |
| `ReserveCopy` (the function's ARN as the `Resource`) | `invoke:catalogue-reserve-copy` | `catalogue` | `static` |
| `WriteLoan` (`dynamodb:putItem`) | the table `circulation-loans` | `circulation` | `static` |
| `RequestCopyPull` (`sqs:sendMessage`) | `sqs/catalogue-copy-pulls`, read by a mapping onto `catalogue-pull-copy` | `catalogue` | `static` |
| `PublishCheckout` (`sns:publish`) | `sns/circulation-checkouts`, subscribed to by `members-record-checkout` | `members` | `static` |
| `AnnounceCheckout` (`events:putEvents`) | `eventbridge/library/library.circulation/LoanCheckedOut`, taken by a rule onto `catalogue-update-availability` | `catalogue` | `static` |
| `SendCheckoutNotice` (`states:startExecution`) | `workflow:members-borrower-notices` | `members` | `static` |

Each step that sends is a producer at the step, with the message it is given
kept as written on its edge onto the channel, and the subscriber the other
repository's Terraform declares is drawn onto the same channel.

`POST /checkouts` in `members` puts `CheckoutRequested` on `library`, and the
rule in `circulation` starts `circulation-checkout` on it: the route is the way
in to a workflow in another repository.

`reshelve-returns` in `catalogue` is read on its own and named after its file
(`workflow-named-by-file`); its step still joins `catalogue-reshelve`, a
function deployed under that name, at `static`.

## Asked of it

`expected.cli/` holds `flow workflow:circulation-checkout`, which walks across
all three repositories, through every send onto its subscriber, and into each
handler; `impact` on a `members` handler, which reaches up through the checkout
workflow in `circulation`; `impact` on the handler `members-borrower-notices`
invokes, with entry points only, which climbs both workflows to the route that
starts the checkout, without `--depth`; `channel` on the event the checkout
puts; and `doctor`.
