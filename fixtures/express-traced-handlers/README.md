# express-traced-handlers fixture

A lending library's loans API in Express, every handler wrapped by a helper that
takes the function as a later argument: the HTTP side of R167, read by the same
rule as a Lambda handler.

Type-checked except for `@lending/telemetry`, which the manifest declares and
`node_modules` deliberately does not hold. `node_modules` holds the suite's usual
hand-written `express` stub.

## The shapes

`src/lib/tracing.ts` holds the repository's own wrappers, and
`src/routes/loans.ts` registers one route in each shape:

| Registration | Entry | `handles` | Confidence |
|---|---|---|---|
| `get('/:id', withSpan('getLoan', getLoan))` | `GET /loans/:param` | `getLoan` | `static` |
| `get('/', listLoansTraced)`, `listLoansTraced = withSpan('listLoans', listLoans)` | `GET /loans` | `listLoans` | `static` |
| `post('/', traced({ name: 'createLoan' }, async (req, res) => …))` | `POST /loans` | the function written in place | `static` |
| `post('/:id/return', instrument(returnLoan, { segment: 'returns' }))` | `POST /loans/:param/return` | `returnLoan` | `heuristic` |
| `get('/:id/holds', firstOf(cachedHolds, tableHolds))` | `GET /loans/:param/holds` | none | a row |

`withSpan` hands on every argument of the handler it builds; `traced` calls what
`withSpan` made of its handler with every argument, so it is as sure as
`withSpan`. `instrument` is from a package that is not installed, so the route
lands on `returnLoan` at `heuristic` and its `wrapperUnread` says why.

## What it does not read

`firstOf(cachedHolds, tableHolds)` is handed two handlers and answers from
whichever has an answer, which is not in the call. It keeps no handler and is
counted in the one `route-handler-anonymous` row.
