# multi-repo-analytics fixture

Five repositories arranged so that each of the four analytics commands has
exactly one thing to find and nothing to guess at. `multi-repo` exists to
exercise the linker; this one exists to exercise what is asked of the graph
afterwards, which needs shapes the linker fixture deliberately has none of:
loops.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/multi-repo-analytics/gateway/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo-analytics/orders/tsconfig.json  --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo-analytics/billing/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo-analytics/admin/tsconfig.json   --noEmit
```

All four are clean. `web/` is not type-checked and is never opened by the tool.

Built, from the repository root:

```
pnpm flowatlas build --config fixtures/multi-repo-analytics/flowatlas.config.json
```

## Services

| Service | Path | Type | `baseUrlEnv` | Why it is here |
|---|---|---|---|---|
| `gateway` | `./gateway` | nestjs | `["GATEWAY_URL"]` | the front door, the guard that reads `JWT_SECRET`, and one half of the HTTP cycle |
| `orders` | `./orders` | nestjs | `["ORDERS_URL"]` | the other half of every loop, and everything `dead` is meant to find |
| `billing` | `./billing` | nestjs | `["BILLING_URL"]` | the far end of the message loop and a handler for a channel nobody publishes |
| `admin` | `./admin` | nestjs | — | a `cron` entry, which must never be reported dead, and the third caller of the hotspot |
| `web` | `./web` | angular | — | skipped, `no-extractor`; every analysis has to cope with a service that contributes nothing |

## The two cross-service cycles

Neither is visible from inside either repository, which is the whole point.

**HTTP.** An account is answered with the customer's recent orders; a recent
order is answered with the account it belongs to.

```
gateway  AccountsController.findOne  ──calls──▶  AccountsService.find
                    ▲                                     │
                    │                                     ▼
        http_calls  │                            OrdersClient.recent
                    │                                     │  GET ${ORDERS_URL}/orders/recent
     orders  AccountsClient.enrich                        ▼
        GET ${GATEWAY_URL}/accounts/:id  ◀──  OrdersController.recent
```

**Messages.** `orders` publishes `order.changed`, `billing` answers with
`invoice.changed`, and `orders` handles that by publishing `order.changed`
again. Two reasonable services and an event storm.

```
orders OrdersService.sync ──emits──▶ channel:order.changed   ──▶ billing OrdersConsumer.onOrderChanged
        ▲                                                                    │
        └── orders InvoicesConsumer.onInvoiceChanged ◀── channel:invoice.changed ◀── billing InvoicesService.sync
```

In the output the two channel hops are collapsed, so the cycle reads
`producer → (channel:order.changed) → consumer` and the channel node is not one
of its nodes.

Two more cycles exist and are not cross-service:

| Cycle | Where | Shown by |
|---|---|---|
| `OrdersService.normalise ↔ expand` | `orders/src/orders/orders.service.ts` | `cycles` without `--cross-service` |
| `PricingService ↔ DiscountService` via `forwardRef` | `orders/src/pricing/` | `cycles --include-di` only |

The `forwardRef` pair is idiomatic Nest and is the reason `injects` is not in
the default edge set: left in, this shape would bury the two above.

## What `dead` finds, and why each row is only a heuristic

| Row | Where | Why it is not proof |
|---|---|---|
| `entry:gateway:http:GET:/internal/legacy` | `gateway/src/orders/legacy.controller.ts` | a route with no internal callers may still be a public API |
| `entry:gateway:http:POST:/orders` | `gateway/src/orders/orders.controller.ts` | `web` posts to it; there is no Angular extractor until P08, so no `hits` edge exists yet |
| `entry:billing:event:orphan.in` | `billing/src/invoices/orphan.consumer.ts` | the publisher could live in a repository the configuration does not name |
| `channel:audit.log` | published by `orders/src/audit/audit.service.ts` | same: a handler may exist outside the graph |
| `channel:orphan.in` | handled by `billing/src/invoices/orphan.consumer.ts` | same, from the other side |
| `UnusedService` | `orders/src/orders/unused.service.ts` | `orders` has unresolved `@Inject` tokens; one of them could be this |

`entry:admin:cron:SyncJob.hourly` is **never** listed. A clock starts it, and
nothing inside the graph ever will.

`fields` is empty and carries the warning `contracts-unavailable`: the checker
lives in `@flowatlas/contracts`, which does not exist until P10.

## What `config "POST /orders"` collects

The flow starts at the guarded gateway route and ends in the `orders`
repository, two HTTP hops away.

| Service | Key | Read in | Why it is on the flow |
|---|---|---|---|
| gateway | `JWT_SECRET` | `AuthGuard.canActivate` | reached through `guarded_by`, which an ordinary forward walk would not follow |
| gateway | `ORDERS_URL` | `OrdersClient.create` | the address the call to `orders` is rooted at |
| orders | `ORDERS_DB_URL` | `OrdersRepository.save` | the far end |
| orders | `BILLING_URL` | `BillingClient.requestInvoice` | the second hop out, in a third repository |

Nothing under `web`, and `GATEWAY_URL` is absent: it is read on the `recent`
flow, not this one. `config --all` lists all six keys across four services.

## The hotspot

`entry:orders:http:POST:/orders/create` has four incoming `http_calls` from
three services: `gateway` twice (`create` and `createDraft`), `billing` once
and `admin` once. It is first with and without `--cross-service`.

One of those four calls is made from `OrphanConsumer`, a handler nothing can
reach. That is deliberate: `hotspots` counts what points at a node, not what
runs, and the difference is worth seeing once.

## Expected snapshots

`expected.cycles.json`, `expected.dead.json`, `expected.config.json` and
`expected.hotspots.json` are what the four commands print for this fixture, and
are compared by `packages/cli/src/commands/analytics.test.ts`. Regenerate them
only with a reviewed diff:

```
pnpm flowatlas build    --config fixtures/multi-repo-analytics/flowatlas.config.json
pnpm flowatlas cycles   --config fixtures/multi-repo-analytics/flowatlas.config.json --format json > fixtures/multi-repo-analytics/expected.cycles.json
pnpm flowatlas dead     --config fixtures/multi-repo-analytics/flowatlas.config.json --format json > fixtures/multi-repo-analytics/expected.dead.json
pnpm flowatlas config   "POST /orders" --config fixtures/multi-repo-analytics/flowatlas.config.json --format json > fixtures/multi-repo-analytics/expected.config.json
pnpm flowatlas hotspots --config fixtures/multi-repo-analytics/flowatlas.config.json --top 10 --format json > fixtures/multi-repo-analytics/expected.hotspots.json
```

There is deliberately no `expected.project-graph.json` here. `multi-repo`
already pins what a build produces, and a second full build snapshot would make
every later extractor phase regenerate two files instead of one for no extra
coverage. What this fixture pins is the four answers above.

## `node_modules` in this fixture

Nothing is installed. `@nestjs/axios`, `@nestjs/config` and `axios` are stubs at
`fixtures/multi-repo-analytics/node_modules/`, one copy for all four
repositories, reached by ordinary upward resolution. `@nestjs/common`,
`@nestjs/core`, `@nestjs/microservices`, `@nestjs/schedule` and `rxjs` resolve
further up, in `fixtures/node_modules`, where they are installed for real. Each
repository still declares every package it uses in its own `package.json`,
because that is what adapter detection reads.
