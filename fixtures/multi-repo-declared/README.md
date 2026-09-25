# multi-repo-declared

Two services, and only one of them has any source here.

`billing` is a service nobody in this project can read: there is no repository,
no framework and no code — only `contracts/billing.json`, an OpenAPI document
somebody else wrote. `api` calls it through `BILLING_URL`, exactly as it would
call a repository, and nothing in `api/src` knows the difference.

This is the fixture for P19. Every claim it makes is a claim about these two
files, and the assertions that hold it to them are in
`packages/linker/src/openapi/read.test.ts` and
`packages/contracts/src/declared.test.ts`.

## The two

| service | what it is | its part |
|---|---|---|
| `api` | nestjs | the caller. `BillingClient` makes every request measured here |
| `billing` | a document | the far end. Its routes, its shapes and nothing else |

## What each pair is for

| pair | expected |
|---|---|
| `CreateInvoiceDto` on `POST /invoices` | `missing_required currency`, `optionality_mismatch note`, `extra_field traceId` — the same three findings two repositories produce |
| `Invoice` on `POST /invoices` and `GET /invoices/{invoiceId}` | `type_mismatch total`: a number over there and text here, plus `extra_field state` for a field the document has and the caller does not |
| `CustomerRef` on `GET /customers/{customerId}` | `identical`. A declared end is a declaration, and two declarations that agree agree |
| `DELETE /invoices/{invoiceId}` | a route nothing reaches. Never an error |

## What must stay true

**The findings read as findings.** A comparison against a declared shape
produces the same kinds of sentence as one against read source, because it is
the same comparison: the document's schemas land in the type registry as
ordinary entries and nothing in `packages/contracts` knows where they came from.

**Every sentence says which half was believed.** Each finding above ends with
`billing was declared by contracts/billing.json, not read`, and each party in
`contracts.json` carries `declaredBy` with the same path. That is the whole
difference between this and the annotation this project deleted: an unverifiable
claim is allowed in, and is never once repeated in the voice the tool uses for
what it has checked.

**The uncalled route is not a fault.** A third party answers callers this
repository has never heard of. `DELETE /invoices/{invoiceId}` is in the document
on purpose so that a change making it an error fails here.

**The error responses are not compared.** `POST /invoices` documents a `422`
with a `Problem` body. Only the lowest success code is read, because the
caller's declared return type is about the success path, and comparing it
against a failure body would report drift on every route that documents its
failures well.

**Every edge touching the declared end is `marker`, including the joins.** Not
only the four `handles` edges the document produced, but the three `http_calls`
edges the linker draws *into* those routes. A join edge is the claim that this
call reaches that route: the caller's half really was read, and the route's half
is somebody's description of itself, and an edge may not claim more than the
weakest of its two ends. This is the confidence a person actually meets, because
`impact` and `flow` walk these edges. It was `static` for one commit, which is
why `packages/linker/src/openapi/join.test.ts` runs the real join over this
fixture rather than over a graph written by hand.

## What is snapshotted here, and what is not

`expected.link-report.json` is recorded: it holds that `billing` was read by
`openapi-document` out of `contracts/billing.json`, that all three calls linked
with none counted as third party, and that one route went uncalled.

There is no `expected.project-graph.json`. The graph carries one row saying how
old the document is, and its two dates are the document's last commit and the
newest commit in this checkout, both of which move whenever anybody commits.
That row is the point of the feature — a stale document is a wrong answer
wearing a confident face — and it is also exactly the kind of fact a byte-for-
byte snapshot cannot hold. The claims about the graph are in the tests instead,
where they are claims rather than recordings (R09).
