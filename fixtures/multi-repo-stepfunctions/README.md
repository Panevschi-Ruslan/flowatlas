# multi-repo-stepfunctions

A state machine in one repository that invokes functions two other
repositories deploy, starts a state machine a third deploys, and writes a table
of its own: the joins P22 makes across repositories by a deployed name.

Synthetic, in a lending library. Type-checked, never executed or deployed.

## The repositories

| Service | What it is | What it deploys |
|---|---|---|
| `circulation` | Terraform only, no `package.json` | the workflow `circulation-checkout`, its definition rendered with `templatefile()`, and the table `circulation-loans` |
| `members` | handlers and Terraform | the functions `members-check-standing` and `members-send-notice`, and the workflow `members-borrower-notices`, loaded with `file()` |
| `catalogue` | handlers and Terraform | the functions `catalogue-reserve-copy` and `catalogue-reshelve`; `workflows/reshelve-returns.asl.json` is a definition nothing here deploys |

## The joins

`circulation` knows the other two repositories only by name. It looks each up
with a data block - `data.aws_lambda_function.check_standing`,
`data.aws_lambda_function.reserve_copy`,
`data.aws_sfn_state_machine.borrower_notices` - and hands their ARNs to the
template. Each is filled with the name the data block names, so:

| Step | Reaches | In | Confidence |
|---|---|---|---|
| `CheckStanding` (`lambda:invoke`, `FunctionName`) | `invoke:members-check-standing` | `members` | `static` |
| `ReserveCopy` (the function's ARN as the `Resource`) | `invoke:catalogue-reserve-copy` | `catalogue` | `static` |
| `WriteLoan` (`dynamodb:putItem`) | the table `circulation-loans` | `circulation` | `static` |
| `SendCheckoutNotice` (`states:startExecution`) | `workflow:members-borrower-notices` | `members` | `static` |

`reshelve-returns` in `catalogue` is read on its own and named after its file
(`workflow-named-by-file`); its step still joins `catalogue-reshelve`, a
function deployed under that name, at `static`.

## Asked of it

`expected.cli/` holds `flow workflow:circulation-checkout`, which walks across
all three repositories and into each handler; `impact` on a `members` handler,
which reaches up through the checkout workflow in `circulation`; `impact` on the
handler `members-borrower-notices` invokes, with entry points only, which
reaches up through that workflow to the checkout that starts it; and `doctor`.
The last `impact` passes `--depth 16`: a walk back up is not lengthened by the
workflows it passes through, and from that handler to the checkout is more than
the default eight hops.
