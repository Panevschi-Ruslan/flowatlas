# nest-configured-clients

A workspace with two tRPC servers, a NestJS worker, and the package of
clients the worker configures (P259). The package builds each client's link
over a base address it is handed - `` `${options.base}/trpc` ``,
`base + '/rpc'` - and provides the clients by tokens from configuring methods
(`forRoot`, `forRootAsync`, `register`) the worker's module calls.

Type-checked, never executed or deployed.

| Package | What it is |
|---|---|
| `apps/orders` | Hono with tRPC's middleware under `/trpc`: `orders.place` |
| `apps/ledger` | Hono with tRPC's middleware under `/rpc`: `entries.record` |
| `packages/clients` | `OrdersClientModule.forRoot` / `forRootAsync`, building the orders client over `options.base`; `ledgerClient(base)`; `AuditModule.register`, providing a value |
| `apps/worker` | NestJS: imports `OrdersClientModule.forRootAsync({ useFactory: () => ({ base: process.env.ORDERS_URL }) })` and `AuditModule.register('worker')`, provides the ledger client as `ledgerClient(process.env.LEDGER_URL)`, and injects all three and a fourth token nobody provides |

What the graph says:

- The worker's `orders.place` call joins the orders service's procedure, its
  link read as `ORDERS_URL` and `/trpc`: `resolved.base` is the option the
  factory `forRootAsync` is handed returns.
- The worker's `entries.record` call joins the ledger's, its link read as
  `LEDGER_URL` and `/rpc`: `base` is what the one call of `ledgerClient` hands.
- `ORDERS_CLIENT` and `AUDIT_CLIENT` are provider nodes where the package
  writes them, injected into `FulfilService`; `forRoot`, which nothing calls,
  provides nothing.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `di-token-unknown` | `apps/worker/src/fulfil.service.ts:15` | nothing provides `REPORTS_CLIENT` |
| `entry-http-routes-unmatched` (note) | `apps/orders`, `apps/ledger` | Hono's `app.use` with tRPC's middleware names no verb and path of its own |
