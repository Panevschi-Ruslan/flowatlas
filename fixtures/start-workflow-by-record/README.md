# start-workflow-by-record

A lending library's loans service whose handler starts a workflow through a
helper that records a run in one call and starts it by the run's id in the
next, so the name of what is started is written one call before the call that
starts it. `orchestrator.create({ process: Process.LoanApproval, loanId })`
returns a run, and `orchestrator.start({ runId: run.id })` is handed only its
id. The helper's package is deliberately not here and is described in
`flowatlas.config.json`, so `flow 'POST /loans'` walks from the route into the
workflow the run starts and on into the function it invokes. This is the
fixture for R171.

Synthetic: one service of Lambda functions behind a REST API, deployed by the
Terraform in `infra/`. Type-checked against the stubs in `node_modules`, never
executed or deployed; the three absent packages have no stub on purpose, and
`@library/notify` has a stub of its declared types and nothing else.

## What each call is read as

| Call | Read as |
|---|---|
| `orchestrator.start({ runId: run.id })` in `create-loan`, after `const run = await orchestrator.create({ process: Process.LoanApproval, loanId })` | `start lending-loan-approval`, at `declared`. The description points at `create`'s `process`; `run.id` is followed back through the `const` to that call, on the same receiver, in the same body, and `Process.LoanApproval` is what the `names` table maps to the deployed name |
| `orchestrator.create(...)` in `create-loan` | nothing of its own: it records the run, and starts nothing. It is not offered a starter description either, though it is handed a member of an enum |
| `problem(ErrorCode.EmptyLoan)` in `create-loan`, from `@library/problems` | nothing. An error builder handed a member of an enum from a package that is not here: the shape the old hint offered a starter description to, and one that starts nothing |
| `orchestrator.start({ runId: event.pathParameters?.['runId'] ?? '' })` in `resume-run` | `start ?`, joined to nothing, and one `start-name-unread` row: the run was recorded somewhere else, so nothing in this body says what it starts, and the locator does not guess |
| `jobs.submit({ jobId: job.id })` in `send-overdue-notices`, after `const job = await jobs.prepare({ kind: Job.OverdueNotices, ... })`, from `@library/jobs` | one `starter-undescribed` row: the package is not installed, and the call is handed an id the same package made earlier in the body. The description it offers points at `prepare`'s `kind` with an `origin-call-argument` locator |
| `notifier.send('lending-notify-borrower', { loanId })` in `create-loan`, from `@library/notify` | one `starter-undescribed` row: the package is installed with its declared types only, and those types reach `LambdaClient`, so the description it offers says `"target": "invoke"` |

The calls into the three absent packages also leave the
`call-dynamic-receiver` information row every call into an absent package does.

## The description

```json
{
  "module": "@library/orchestration",
  "function": "start",
  "target": "workflow",
  "name": [{ "kind": "origin-call-argument", "call": "create", "path": ["process"] }],
  "names": { "Process.LoanApproval": "lending-loan-approval" }
}
```

## Asked of it

`expected.cli/` holds `flow` for `POST /loans`, as a tree and as JSON at detail
2 where the confidence of the join is written out, `flow` for the resume route,
and `doctor`.
