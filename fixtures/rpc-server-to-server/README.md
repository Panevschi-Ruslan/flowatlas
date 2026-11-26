# rpc-server-to-server

A server that is a client of two other servers' procedure trees (P242): no
browser anywhere, so every request here is one service asking another.

## Three services

- `orders` is an Express service serving an oRPC tree (`orders.place`,
  `orders.get`) through an `RPCHandler` at `/rpc`. It claims `ORDERS_URL` as
  its base under `services[].baseUrlEnv`.
- `billing` is an Express service serving a tRPC tree (`invoices.create`,
  `invoices.byOrder`, `invoices.refund`, and the subscription `invoices.paid`)
  through `createExpressMiddleware` at `/trpc`. The configuration says it is
  reached at `billing.internal` (`services[].hosts`).
- `worker` is a NestJS application whose `POST /fulfil/:sku` places an order,
  bills it and reads its invoices, through two providers that keep the clients:
  - `OrdersClient` holds `createORPCClient(new RPCLink({ url:
    `${process.env.ORDERS_URL}/rpc` }))` in a member set where it is declared;
  - `BillingClient` sets `createTRPCClient({ links: [loggerLink(),
    splitLink({ true: wsLink(…), false: httpBatchLink({ url:
    'http://billing.internal/trpc' }) })] })` in its constructor;
  - `src/refunds.ts` has module-level clients: an untyped tRPC client rooted at
    `PAYMENTS_URL`, an oRPC client rooted at `LEGACY_URL`, one whose URL is a
    function, and a tRPC client of a third party's host.

## What joins

- `orders.place` and `orders.get` from `OrdersClient` join orders' procedures,
  `static`, `via: link-url`: `ORDERS_URL` is claimed by orders. The link's
  path `/rpc` is where the `RPCHandler` is mounted, so nothing is unserved.
- `invoices.create` (a mutation) and `invoices.byOrder` (a query) join
  billing's, `static`: the HTTP branch of the split writes `billing.internal`,
  which billing is reached at. `loggerLink` in front is stepped over.
- `payments.mutation('invoices.refund', …)` joins billing's `invoices.refund`,
  `heuristic`: no service claims `PAYMENTS_URL`, and the worker's own
  `.env.example` gives it `http://billing.internal:4000`. A
  `base-url-from-files` row says so.
- `ledger.entries.record.mutate(…)` goes to `external_api:ledger.partner.example`:
  a host no service is reached at is a third party.
- `flow 'POST /fulfil/:param'` walks from the worker's route through each
  provider's method into the procedure's handler in the other service.

## Rows that remain

- `invoices.paid` is subscribed to over the split's WebSocket branch, whose
  address is the WebSocket client's and is not read: `procedure-link-socket`,
  and, since nothing else says where it goes, `procedure-not-found` naming
  billing as the service that declares it.
- `orders.audit` is asked of orders, which does not declare it:
  `procedure-not-found` naming the two services asked.
- `legacy.orders.list()` is rooted at `LEGACY_URL`, which no service claims and
  nothing gives a value: `unknown-base-url-env`, and no join.
- `discovered.orders.get(…)` is sent through a link whose URL is a function:
  `procedure-link-dynamic`, then `procedure-not-found` naming orders, since the
  worker names no service to ask instead.

No `call-dynamic-receiver` row is left for the clients typed `any`: each call
was read as a request, which is following it.

## The stubs

`express` and `@orpc/server` (with its Node adapter) under `orders`,
`express` and `@trpc/server` (with its Express adapter) under `billing`,
`@orpc/client` and `@trpc/client` under `worker`; the NestJS packages are the
shared ones under `fixtures/node_modules`.
