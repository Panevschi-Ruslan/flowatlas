# start-workflow-helper

A lending library's loans service whose handlers start workflows through the
project's own helpers rather than the AWS SDK: one helper is a package of this
workspace, whose source is read, and one comes from a package that is
deliberately not here and is described in `flowatlas.config.json`. This is the
fixture for the case P24 was designed for, and `flow 'POST /loans'` walks from
the route into both workflows the handler starts and on into the functions each
invokes.

Synthetic: a workspace of the service (`loans`) and the package it starts its
workflows through (`packages/workflows`). Type-checked against the stubs in
`node_modules`, never executed or deployed; the two absent packages have no stub
on purpose.

## What each call is read as

| Call | Read as |
|---|---|
| `workflows.start(process.env.LOAN_APPROVAL_ARN, loan)` in `create-loan`, from `@library/workflows` | `start lending-loan-approval`, at `static`, drawn at this call. The helper's own `sfn.send(new StartExecutionCommand({ stateMachineArn }))` is handed the name as a parameter, so it is followed out to the caller that decides it, and the caller's argument is read as the helper's would have been: here a variable the function is deployed with, completed from its Terraform. Nothing is drawn inside the helper |
| `orchestrator.run(Process.ReserveCopies, ...)` in `create-loan`, from `@library/orchestration` | `start lending-reserve-copies`, at `declared`. The package is not installed, so `Process.ReserveCopies` cannot be read; the description's `names` table says what it is deployed as, and somebody's statement is what the join rests on |
| `orchestrator.run('lending-loan-approval', ...)` in `renew-loan` | `start lending-loan-approval`, at `static`: the description says which call it is, the code states the name, and the deployment confirms it |
| `scheduler.schedule(Reminder.LoanDue, ...)` in `renew-loan`, from `@library/scheduling` | nothing, and no `starter-undescribed` row. It is not installed and it is called from a deployed function, but a member of an enum is all it is handed, which is what an error builder or a code converter is handed too (R171). The calls that row is offered to are in `fixtures/start-workflow-by-record` |

`orchestrator.run` and `scheduler.schedule` also leave the
`call-dynamic-receiver` information row every call into an absent package does.

## The description

```json
{
  "module": "@library/orchestration",
  "function": "run",
  "target": "workflow",
  "name": [{ "kind": "argument", "index": 0 }],
  "names": { "Process.ReserveCopies": "lending-reserve-copies" }
}
```

`function` with `module` matches `run(...)` imported by name as readily as
`orchestrator.run(...)` on an object the package exports.

## Asked of it

`expected.cli/` holds `flow` for `POST /loans`, as a tree and as JSON at detail
2 where the confidence of each join is written out, `flow` for the renewal, and
`doctor`.
