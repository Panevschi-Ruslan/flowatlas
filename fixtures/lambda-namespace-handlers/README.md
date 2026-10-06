# lambda-namespace-handlers

The circulation desk of a lending library as Lambda functions behind a REST API
and two SQS queues, written the way a project that keeps its logic apart from
its entry points often is: `src/operations` holds the functions, and each module
under `src/handlers` re-exports some of them, in one of the ways a module can
(R168).

Type-checked except for `@lending/batch`, which the manifest declares and
`node_modules` deliberately does not hold. `node_modules` holds hand-written
stubs of `@types/aws-lambda` and `@aws-sdk/client-sqs`.

## The shapes

`infra/functions.tf` declares seven functions, all packaged from `src`.

| Function | Handler | How the handler module exports it | `handles` |
|---|---|---|---|
| `library-desk-create-loan` | `handlers/loans.createLoan` | `export const createLoan = loans.createLoan`, `import * as loans` | `createLoan` in `operations/loans.ts` |
| `library-desk-renew-loan` | `handlers/loans.renewLoan` | `export const renewLoan = loans['renewLoan']` | `renewLoan`, a function declaration |
| `library-desk-place-hold` | `handlers/holds.placeHold` | `export { placeHold } from` | `placeHold` in `operations/holds.ts` |
| `library-desk-cancel-hold` | `handlers/holds.cancelHold` | `export { withdrawHold as cancelHold } from` | `withdrawHold` |
| `library-desk-record-return` | `handlers/returns.recordReturn` | `export * from` | `recordReturn` in `operations/returns.ts` |
| `library-desk-process-returns` | `handlers/consumers.processReturns` | `operations.processReturns`, a namespace import of `operations/index.ts`, which re-exports it with `export *` | `processReturns` |
| `library-desk-archive-loan` | `handlers/consumers.archiveLoan` | `operations.archiveLoan`, re-exported by `export { } from` from `operations/archive.ts`, where it is what `batchHandler({ … })` builds | none: one `function-handler-unread` row |

Every edge that lands is `static`. Each route of the API is an `http` entry onto
the same function as the function it integrates with; `POST
/loans/{loanId}/archive`, whose function's handler is not read, reaches that
function's `invoke` entry instead (R173).

## The paths

`POST /loans` runs `createLoan`, which sends to `sqs/library-desk-loans-opened`,
which an event-source mapping delivers to `library-desk-archive-loan`. Its handler
is built by a package that is not installed, so the walk stops at the function's
entry, and the row recorded against that entry is counted:
`unresolved on this path: 1`.

`POST /loans/:param/archive` is integrated straight with
`library-desk-archive-loan`. With no handler to run, the route reaches the
function's entry, and the same row is counted: `unresolved on this path: 1`. It
used to end at the route and count 0.

`POST /returns` runs `recordReturn`, which sends to `sqs/library-desk-returns`,
which `library-desk-process-returns` reads, and the walk goes on into
`processReturns`: `unresolved on this path: 0`.
