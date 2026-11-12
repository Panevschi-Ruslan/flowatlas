# rpc-contracts

What a call through an oRPC or tRPC client hands a procedure and reads back,
compared with what the procedure declares (P247), and the rest of the
procedure-client reader: a tRPC tree's mount, a client injected by a token,
an Angular client, and a client of a repository that is not here.

## Five services

- `orders` is an Express service serving an oRPC tree through an `RPCHandler`
  at `/rpc`. `orders.place` takes `{ sku, quantity }` and answers `{ id }`;
  `orders.get` takes `{ id }` and answers an order; `orders.count` declares no
  input. It claims `ORDERS_URL`.
- `billing` is an Express service serving a tRPC tree, every procedure with an
  input schema (`invoices.create`, `invoices.byOrder`, `invoices.void`). Its
  middleware is assigned to a name and handed to `app.use('/trpc', trpc)`, so
  it is served at `/trpc`. It claims `BILLING_URL`.
- `ledger` is tRPC's standalone server, `createHTTPServer({ router, basePath:
  '/api/' })`, serving `entries.record` at `/api`. It claims `LEDGER_URL`.
- `worker` is a NestJS application whose `POST /fulfil/:sku` calls all of them:
  - `OrdersClient` holds an oRPC client typed by the worker's own copy of the
    orders tree (`src/orders.api.ts`), which has drifted: `place` is handed a
    `qty` where the procedure takes `quantity`, and is read back with a `total`
    the procedure never answers.
  - `BillingModule` provides two clients for tokens, built in `useFactory`
    factories (one written in place, one named), and `BillingService` is
    handed them by `@Inject(BILLING_CLIENT)` and `@Inject(BILLING_UNTYPED)`.
    The typed one is `any`; `invoicesOf` sends `{ order }` where billing's
    `byOrder` takes `{ orderId }`.
  - `LedgerClient` sends to `${LEDGER_URL}/trpc`, which is not where the
    ledger serves its tree.
  - `ArchiveClient` is rooted at `ARCHIVE_URL`, which no service claims; the
    worker's `.env.example` gives it `http://archive.shop.internal:7000`.
- `portal` is an Angular application whose `InvoicesService` calls billing
  through a client made at the top of `src/app/trpc.ts` and through one
  provided for the `TRPC` token and injected with `inject(TRPC)`. Its
  `apiTarget` names billing.

## What `contracts` says

- **Findings.** `orders.place` from the worker: `quantity` is required and not
  sent (`missing_required`, error), `qty` is sent and not declared
  (`extra_field`, info), and the answer's `total` is read and never answered
  (`missing_required`, error). `invoices.byOrder` from the worker: `orderId`
  required and not sent, `order` sent and not declared.
- **Compared, with nothing found.** `orders.get` both ways (the answer is the
  worker's own `Order`, the same shape under another name), `orders.count`'s
  answer, and every input the other billing calls, the ledger call and the
  portal's calls hand.
- **Unchecked, with the reason.** `orders.count`'s input
  (`procedure-input-undeclared`); the answer of every call through a client
  typed `any` or an untyped client (`no-type-on-receiver`, with the hint to
  type the client from the tree it calls).

## What the graph says

- billing's and ledger's procedures carry `meta.mounted` with protocol `trpc`
  and prefixes `/trpc` and `/api`.
- The worker's ledger call joins `entries.record` and is
  `procedure-link-unserved`: sent to `/trpc`, served at `/api`.
- `invoices.create`, `invoices.byOrder` and `invoices.void` from the worker
  join billing by `BILLING_URL`, read through the tokens' factories; no
  `call-through-token` row is left at those calls.
- The portal's two calls are `ui_api_call`s of kind `rpc`, read by the Angular
  reader, joined to billing by `apiTarget`.
- `orders.store` from the worker is `unknown-base-url-env`, and `doctor` names
  "archive" as probably missing: the setting, and the host its example value
  names.

## The stubs

`express`, `@orpc/server` (with its Node adapter) and `zod` under `orders`;
`express`, `@trpc/server` (with its Express adapter) and `zod` under `billing`;
`@trpc/server` with its standalone adapter and `zod` under `ledger`;
`@orpc/client` and `@trpc/client` under `worker`; `@angular/core` and
`@trpc/client` under `portal`. The NestJS packages are the shared ones under
`fixtures/node_modules`. The `zod` stub carries a schema's type as `_output`
only, so the input side is that type too.
