# multi-repo fixture

One project, four repositories that call each other. Everything the linker has
to stitch is here exactly once: an HTTP call that links, one that names a route
the target does not have, one whose base URL no service claims, one that only a
marker can resolve, one that leaves for a third party, a channel with both ends,
a channel with only a producer, a channel with only a consumer, a route nobody
calls, and a browser whose button reaches the table at the far end.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/multi-repo/gateway/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo/orders/tsconfig.json  --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo/billing/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/multi-repo/web/tsconfig.json     --noEmit
```

All four are clean. `web/` gained hand-written `@angular/*` stubs in P08, when it
stopped being the service with no extractor and became the head of the chain.

Built, from the repository root:

```
pnpm flowatlas build --config fixtures/multi-repo/flowatlas.config.json
```

## Services

| Service | Path | Type | `baseUrlEnv` | Extracted |
|---|---|---|---|---|
| `gateway` | `./gateway` | nestjs | — (only the browser calls it) | yes |
| `orders` | `./orders` | nestjs | `["ORDERS_URL"]` | yes |
| `billing` | `./billing` | nestjs | `["BILLING_URL"]` | yes |
| `web` | `./web` | angular | `apiBaseEnv: ["apiUrl", "ordersUrl"]`, `apiTarget: { "apiUrl": "gateway" }` | yes, since P08 |

`sharedPackages: ["@fx/contracts"]`, `output: ".flowatlas"`.

`web` is the only service with `apiTarget`: it is a browser, so the key its
addresses are rooted at names a backend rather than itself. `ordersUrl` is
deliberately left out of `apiTarget`, which is what makes the request rooted at
it ambiguous. `flowatlas build --skip-frontend` leaves `web` out and reports it
exactly as a service with no extractor, with `error: "left out by
--skip-frontend"` saying why.

## Cross-service HTTP — one row per `http_out`

The gateway's outgoing calls are in `gateway/src/clients/`; billing makes one
of its own (P209). There are seven, which is `httpOut.total`: §12's five, the
two-hole address R01 added, and billing's.

| Call site | file:line | Address | Links to | Confidence / `meta.via` | Bucket | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `http.get<OrderDto>(...)` | `gateway/src/clients/orders.client.ts:33` | `${ORDERS_URL}/orders/${id}` | `entry:orders:http:GET:/orders/:param` | `static` / `baseUrlEnv` | `linked` | — |
| `http.post<OrderDto>(...)` | `gateway/src/clients/orders.client.ts:44` | `${ORDERS_URL}/orders/${id}/cancel` | nothing — `orders` has `POST /orders/:param/archive`, never `cancel` | — | `noRoute` | `target-route-not-found` |
| `http.get<OrderDto>(...)` | `gateway/src/clients/orders.client.ts:59` | `${ORDERS_URL}/orders/${id}${suffix}` | nothing — two holes in a row could be one segment or several (R01) | — | `dynamic` | — |
| `http.post(...)` | `gateway/src/clients/payments.client.ts:24` | `${PAYMENTS_URL}/pay` | nothing — no service declares `PAYMENTS_URL` | — | `unknownEnv` | `unknown-base-url-env` |
| `http.post<InvoiceDto>(registry.invoicesUrl(), …)` | `gateway/src/clients/billing.client.ts:33`, marker at `:31` | built at run time | `entry:billing:http:POST:/invoices` | `marker` / `marker` | `linked` + `byMarker` | — |
| `axios.post('https://api.stripe.com/v1/charges', …)` | `gateway/src/clients/payments.client.ts:34` | absolute | `external_api:api.stripe.com` (already from P03) | `static` | `external` | — |
| `http.get<OrderView>(...)` | `billing/src/invoices/invoices.service.ts:33` | `${ORDERS_URL}/orders/${body.orderId}` | `entry:orders:http:GET:/orders/:param` | `static` / `baseUrlEnv` | `linked` | — |

The last row is billing reading back the order it invoices, from
`InvoicesService.create`, which `POST /invoices` and both consumers go
through. It lands on the route the gateway's first row reaches, so it moves no
route from `uncalled` to `called`; it gives `order.created` a way back into
`orders` (the `POST /orders` flow now ends at the table twice), and it gives
billing's @nestjs/observe batch a call of its own to join (see the traces
below). `OrderView` is billing's own copy of the two fields it reads, so the
contract check of that edge says `info` twice: orders sends `customerId` and
`total`, which billing does not declare.

The exact message §12 pins, from row 2:

```
target service orders has no route POST /orders/:param/cancel
```

Row 4 is the only `marker` edge in the project. It must produce **one**
`http_calls` edge and no second one, and it must be counted in `byMarker`, not
in `dynamic`: the address is unreadable, but the marker resolved it (D3).

## Channels — one row per producer and consumer

| Side | Call site / handler | file:line | Channel | Result |
|---|---|---|---|---|
| producer | `events.emit('order.created', dto)` | `orders/src/orders/orders.service.ts:49` | `channel:order.created` | pairs with the consumer below |
| consumer | `@EventPattern('order.created')` | `billing/src/invoices/invoices.consumer.ts:17` | `channel:order.created` | pairs with the producer above |
| producer | `events.emit('order.archived', …)` | `orders/src/orders/orders.service.ts:61` | `channel:order.archived` | `channels.noConsumers` |
| consumer | `@EventPattern('invoice.requested')` | `billing/src/invoices/invoices.consumer.ts:28` | `channel:invoice.requested` | `channels.noProducers` |

`channel:order.created` is produced in one repository and consumed in another and
must exist **once**: channel ids carry no repo prefix, which is the whole point
of them (I6, §12). Orphans on either side are **report** entries, never
`unresolved` (D7).

## Routes — who calls what

| Entry | Declared at | Called by |
|---|---|---|
| `entry:gateway:http:GET:/orders/:param` | `gateway/src/orders/orders.controller.ts:30` | `web`, `hits`, `static`, the head of the chain below |
| `entry:gateway:http:POST:/orders/:param/cancel` | `gateway/src/orders/orders.controller.ts:35` | nobody, `uncalled` |
| `entry:gateway:http:POST:/orders/:param/invoice` | `gateway/src/orders/orders.controller.ts:40` | `web`, `hits`, one `static` and two `marker` (R39) |
| `entry:gateway:http:POST:/orders/pay` | `gateway/src/orders/orders.controller.ts:45` | nobody, `uncalled` |
| `entry:gateway:http:POST:/orders/charge` | `gateway/src/orders/orders.controller.ts:50` | nobody, `uncalled` |
| `entry:gateway:http:POST:/orders/:param/ship` | `gateway/src/orders/orders.controller.ts:60` | `web`, `hits`, `static` |
| `entry:gateway:http:POST:/orders/:param/refund` | `gateway/src/orders/orders.controller.ts:65` | `web`, `hits`, `static` |
| `entry:gateway:http:POST:/orders/:param/resume` | `gateway/src/orders/orders.controller.ts:71` | `web`, `hits`, `static` |
| `entry:orders:http:GET:/orders/latest` | `orders/src/orders/orders.controller.ts:19` | nobody, `uncalled` — the literal half of the §10 pair |
| `entry:orders:http:GET:/orders/:param` | `orders/src/orders/orders.controller.ts:25` | `gateway` and `billing` (P209), `static` |
| `entry:orders:http:POST:/orders` | `orders/src/orders/orders.controller.ts:31` | nobody, `uncalled` |
| `entry:orders:http:POST:/orders/:param/archive` | `orders/src/orders/orders.controller.ts:42` | nobody, `uncalled` — the route `cancel` was renamed to |
| `entry:orders:http:GET:/a/:param` | `orders/src/aliases/legacy-aliases.controller.ts:18` **and** `orders/src/aliases/current-aliases.controller.ts:11` | nobody, `uncalled` — the deliberate duplicate |
| `entry:billing:http:POST:/invoices` | `billing/src/invoices/invoices.controller.ts:15` | `gateway`, `marker` |
| `entry:billing:http:GET:/invoices/:param` | `billing/src/invoices/invoices.controller.ts:26` | nobody, `uncalled` — the one §12 names |

`GET /orders/latest` next to `GET /orders/:param` is §10 rows 6-8: the client
asks for `/orders/${id}`, whose segment is itself a parameter, so it matches the
`:param` route exactly and never the literal one. A client asking for
`/orders/latest` would match the literal one. Neither case is ambiguous.

## Requests the browser makes — one row per `ui_api_call`

All six are in `web/src/app/orders-api.service.ts`.

| Call site | Address | Links to | Confidence / `meta.via` | `unresolved.reason` |
|---|---|---|---|---|
| `order`, `get<OrderDto>(\`${environment.apiUrl}/orders/${id}\`)` | `GET /orders/:param` | `entry:gateway:http:GET:/orders/:param` | `static` / `api-target` | — |
| `receipt`, `get<unknown>(\`${environment.apiUrl}/orders/${id}/receipt\`)` | `GET /orders/:param/receipt` | nothing, the gateway has no such route | — | `target-route-not-found` |
| `mirror`, `get<OrderDto>(\`${environment.ordersUrl}/orders/${id}\`)` | `GET /orders/:param` | nothing, `gateway` and `orders` both answer it | — | `ambiguous-route-target` |
| `summary`, `get<unknown>(\`${environment.apiUrl}/orders/${id}-summary\`)` | `GET /orders/${…}` | nothing, the hole runs into text so the path was not read (R01) | — | `api-path-partly-read` |
| `invoice`, `post<unknown>(this.urlFor(\`${id}/invoice\`), {})` | `POST /orders/:param/invoice` | `entry:gateway:http:POST:/orders/:param/invoice` | `static` / `api-target` | — |
| `one`, `get<OrderDto>(this.maybeUnder(id))` | `GET /orders/:param` | `entry:gateway:http:GET:/orders/:param` | `heuristic` / `api-target` | — |

The second is drift of the same kind as `POST /orders/:param/cancel`, seen from
the browser instead of from a service. The third is the case only configuration
can settle: two services really do serve that route, and guessing between them
would draw an edge to a service the browser never reaches (P08 D4).

The sixth is the branch nobody settled (R11). `maybeUnder` appends only when it
is given something, and `one` passes a bare parameter, so whether it appends is
decided by whoever calls `one`. Writing an argument at all is not asking for the
default the guard exists for, so the branch it takes is the answer — and the
request carries `meta.guessed: true`, which is what makes the `hits` edge say
`heuristic` where the first row says `static`. The service on the far end is
proof and the path is a guess; the edge claims the weaker of the two.

## The chain §12 walks end to end

```
ui_action:web#src/app/checkout.component.ts:15:22   (click)="checkout()"
  --handles-->  web      CheckoutComponent.checkout    checkout.component.ts:20
  --calls-->    web      OrdersApiService.order        orders-api.service.ts:20
  --calls-->    web      ui_api_call GET /orders/:param orders-api.service.ts:21
  --hits-->              entry:gateway:http:GET:/orders/:param
  --handles-->  gateway  OrdersController.findOne      orders.controller.ts:31
  --calls-->    gateway  OrdersClient.fetchOne         orders.client.ts:32
  --calls-->    gateway  http_out GET /orders/:param   orders.client.ts:33
  --http_calls->         entry:orders:http:GET:/orders/:param
  --handles-->  orders   OrdersController.findOne      orders.controller.ts:26
  --calls-->    orders   OrdersService.findOne         orders.service.ts:25
  --calls-->    orders   db_query read orders          orders.service.ts:26
  --queries-->  table:orders#orders
```

Twelve hops from the button, so `traverse({ from, direction: 'out' })` needs
`maxDepth: 12`. Starting at `entry:gateway:http:GET:/orders/:param` instead, the
eight hops P05 pinned are still exactly eight; the default of 6 stops two short,
at the `orders` controller.

This is the whole point of the tool in one walk: a click in a browser, three
repositories, a database table at the end, and every edge on the way saying how
far it can be trusted.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `${ORDERS_URL}/orders/${id}/cancel` | `gateway/src/clients/orders.client.ts:44` | `target-route-not-found`, message `target service orders has no route POST /orders/:param/cancel`, hint naming `orders`' controllers or `@CallsService` |
| `${PAYMENTS_URL}/pay` | `gateway/src/clients/payments.client.ts:24` | `unknown-base-url-env`, hint "add `PAYMENTS_URL` to `services[].baseUrlEnv` of the target service in flowatlas.config.json" |
| `registry.invoicesUrl()` | `gateway/src/clients/billing.client.ts:33` | P03's own `dynamic-http-url`, which stays in `ProjectGraph.unresolved` tagged `service: "gateway"`. The linker adds **no** `http-out-dynamic` on top of it, because the marker on line 31 resolved the target |
| `emit('order.archived', …)` | `orders/src/orders/orders.service.ts:61` | report `channels.noConsumers`, not an unresolved (D7) |
| `@EventPattern('invoice.requested')` | `billing/src/invoices/invoices.consumer.ts:28` | report `channels.noProducers`, not an unresolved (D7) |
| `GET /a/:param` twice | `orders/src/aliases/*.ts` | `ambiguous-route` for any client that calls it — nothing here does, which is why `httpOut.ambiguous` is 0. See the note below |
| `${environment.apiUrl}/orders/${id}/receipt` | `web/src/app/orders-api.service.ts:26` | `target-route-not-found`, message `target service gateway has no route GET /orders/:param/receipt` |
| `${environment.ordersUrl}/orders/${id}` | `web/src/app/orders-api.service.ts:34` | `ambiguous-route-target`, hint naming `services[].apiTarget` |

Two reasons of §6 are **not** exercised here: `marker-service-unknown` and
`marker-route-not-found`. Either one needs another `http_out` of its own, which
would move every count below for a reason this project does not have, so both
belong in `matchRoute`'s and the marker resolver's own unit tests.

### A note on the duplicate `GET /a/:param`

The entry id grammar is `entry:<service>:http:<METHOD>:<path>` and carries no
controller, and `GraphBuilder.addNode` keeps the first node for an id it already
holds. Two controllers declaring the same method and path in **one** repository
therefore collapse into **one** entry node with **two** `handles` edges —
`LegacyAliasesController.resolve` and `CurrentAliasesController.resolve` — and
`meta.controller` from whichever was indexed first.

So the pair here is a duplicate-route detector, not an `ambiguous-route`
producer: `matchRoute` is handed one candidate and cannot return two. It is
reported as `routes.duplicated`, which is a real drift detector in its own right
— the same fault turns up in real projects.

Genuine ambiguity needs two differently spelled paths that both match one client
path (`/a/:param/x` and `/a/x/:param` for a client asking `/a/x/x`), and that
pair lives in `route-match.test.ts` and `link.test.ts` rather than here, where it
would add routes §11 does not name and move the counts below.

## Expected counts (§12, as measured now)

§12 fixed the first figures; the ones below are what `expected.link-report.json`
says today, after the tickets that added to the fixture (R01's two-hole
address, the browser's later requests and routes, billing's call in P209).

```jsonc
"httpOut":  { "total": 7, "linked": 3, "byMarker": 1, "unknownEnv": 1,
              "noRoute": 1, "ambiguous": 0, "external": 1, "dynamic": 1 }
```

`linked + unknownEnv + noRoute + ambiguous + external + dynamic == total`
(3+1+1+0+1+1 = 7); `byMarker` is the subset of `linked` that a marker resolved.

```jsonc
"channels": { "total": 3, "linked": 1,
              "noConsumers": ["channel:order.archived"],
              "noProducers": ["channel:invoice.requested"] }
```

`linked + |noConsumers| + |noProducers| == total` (1+1+1 = 3).

```jsonc
"ui":       { "total": 13, "resolved": 6, "unresolved": 7,
              "byReason": { "ambiguous-route-target": 1,
                            "api-path-dynamic": 3,
                            "api-path-partly-read": 1,
                            "target-route-not-found": 2 } }
```

`resolved + unresolved == total`, and `byReason` sums to `unresolved`: every
request the browser makes is in exactly one bucket, and every bucket but the
first says why.

```jsonc
"routes":   { "total": 15, "called": 7, "uncalled": [ /* 8 ids */ ],
              "duplicated": ["entry:orders:http:GET:/a/:param"] }
```

`duplicated` is where the `GET /a/:param` pair shows up: one entry node, two
`handles` edges, and a framework that answers with whichever controller it
registered first.

What follows from the fixture rather than from §12, and is worth asserting once
the passes exist:

- `routes`: 16 route declarations, **15** `entry` nodes with `kind: "http"` (the
  `/a/:param` pair is one node), `called: 7`, so `uncalled` has 8 ids and must
  contain `entry:billing:http:GET:/invoices/:param`. Billing's call reaches a
  route the gateway already reaches, so it moves none of these.
- `types`: `OrderDto` appears once as `type:@fx/contracts#OrderDto`, with
  `meta.sharedPackage: "@fx/contracts"`, and both the `returns` of the linked
  `http_calls` edge and `orders`' handler point at that id. `Money`,
  `OrderStatus` and `CreateOrderDto` merge the same way; how many of them reach
  the registry depends on `types.maxDepth`. The browser's own `type:web#OrderDto`
  is a **second** shape of the same name on purpose: `web` declares its own copy,
  which is how a frontend and a backend drift apart and is what P10 will compare
  across the `hits` edge.
- `services[]`: four entries, all four extracted.
- 130 nodes and 114 edges (`expected.link-report.json` `totals`), of which
  `billing` contributes 23 nodes and 18 edges and `web` 32 nodes and 21 edges;
  the linker adds three `http_calls` edges (two `static`, one `marker`) and
  eight `hits` edges. Billing's call is 4 of those nodes (the `http_out`, the
  `ORDERS_URL` key, `HttpService` and `ConfigService`) and 5 of those edges
  (two `injects`, `reads_config`, `calls` and its `http_calls`).
- Two consecutive builds produce a byte-identical `project-graph.json` except
  `builtAt` (D8).

## `node_modules` in this fixture

Nothing here is installed, and `pnpm-workspace.yaml` does not cover
`fixtures/multi-repo/*`, so every import resolves through a hand-written stub or
through the shared `fixtures/node_modules`:

| Package | Where it comes from |
|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/microservices`, `rxjs` | installed for real in `fixtures/node_modules` — `ClientProxy`, `@EventPattern` and `@Payload` resolve to the library's own declarations |
| `@flowatlas/markers` | linked into `fixtures/node_modules` from `packages/markers` (its `dist/` must be built) |
| `@nestjs/axios`, `@nestjs/config`, `axios` | `gateway/node_modules/*` and `billing/node_modules/*` — copies of the `nest-leaves` stubs, byte-identical between the two |
| `typeorm` | `orders/node_modules/typeorm` — a copy of the `nest-typeorm` stub, so the chain has a real data layer at its far end |
| `@fx/contracts` | `gateway/node_modules/@fx/contracts` and `orders/node_modules/@fx/contracts` — two **byte-identical** copies |
| `@angular/core`, `@angular/common/http`, `rxjs` | `web/node_modules/*` — copies of the `angular-basic` stubs, holding only the declarations the extractor reads |

`shared/contracts/` is the source of truth for `@fx/contracts` and is what
`package.json` points at (`file:../shared/contracts`), but nothing resolves to
it: the two `node_modules` copies are what the type-checker and the extractor
read, and they must stay identical, because the merge of a shared-package type
compares `structuralHash` across repositories (D6).

```
diff fixtures/multi-repo/gateway/node_modules/@fx/contracts/index.d.ts \
     fixtures/multi-repo/orders/node_modules/@fx/contracts/index.d.ts
```

> The stubs live at `fixtures/multi-repo/<repo>/node_modules/**`, which the
> repository's `.gitignore` re-includes (`!fixtures/*/*/node_modules/**`), so
> they are committed and the fixture type-checks on a fresh clone.

`expected.project-graph.json` and `expected.link-report.json` are generated by
running the tool and reviewed as a diff, never written by hand:

```
pnpm flowatlas build --config fixtures/multi-repo/flowatlas.config.json
node scripts/fixtures-check.mjs --update
node scripts/mcp-snapshots.mjs --update
```

## An annotated browser request (R39)

`OrdersApiService.probe` and `.twoBlind` are the two halves of one rule.
`@flowatlas-calls` does not repair the request it sits above — it adds a second
request that joins — so the unreadable one keeps its row, and the question is
whether the annotation can be about anything else.

| method | requests | annotations | expected |
|---|---|---|---|
| `probe` | one unreadable | one, reaching a route | the row at `info`: nothing to do |
| `twoBlind` | two unreadable | one, reaching a route | both rows kept, and the hint says why |

An annotation that reached no route counts for nothing here: the reader still
has something to fix, and the marker checks say what.

## A page tied to its flows (P120)

`docs/architecture.md` is the project's own page, with doc blocks that
`flowatlas docs` checks against the graph: the gateway's `GET /orders/:param`
as a tree and as a tour (with notes under two steps), `POST /orders` as a
sequence diagram and as a contract table, `order.created` as a flowchart, a
`ref` to `OrdersService.create` in a sentence, a block naming a route that
does not exist (`gone`) and one naming a route two services serve without
saying which (`ambiguous`). The contract block is left as a person writes it,
unfilled, so a check calls it `changed` until it is written. The configuration
points `docs.files` at the page, and `fixtures-run` writes the `docs.json` the
MCP snapshots read.

`expected.cli/docs.check.{txt,json}`, `docs.check.github.txt` and
`docs.list.txt` are what the check says; `docs.architecture.md` is the page as
`flowatlas docs --write` leaves it (written on a copy). Once a flow the page
describes changes, `docs.check.txt` says so: regenerate the page with
`node packages/cli/bin/flowatlas.js docs --write --config fixtures/multi-repo/flowatlas.config.json`
and review it like any other snapshot.

## Traffic over the map (P65, P85, P105, P110)

`traces/` holds what `flowatlas observe` reads, written by hand with values
planted that no reader may keep (`packages/cli/src/observe/__fixtures__/planted.ts`):

| file | format | what it is there for |
|---|---|---|
| `checkout.otlp.json` | OTLP/JSON | a slow `GET /orders/:id` hop from `gateway` to `orders` (500 ms on the caller's span), a `POST /orders` that answers 500 with `status.code: 2`, a publish and its consumer, a call that fits two call sites, and a span with no times |
| `billing.observe.json` | @nestjs/observe batch | one batch in the SDK's 0.3.12 wire contract (P202): two HTTP requests with span trees (billing's call to `orders`, a database insert, a manual span), a NATS message on `order.created` whose tree makes the same call, a scheduled job, and logs, objectives, runtime and custom metrics no reader may keep |
| `orders.observe.json` | @nestjs/observe batch | orders' answer to billing's call in the `POST /invoices` trace (P209): the same `ti`, which billing's agent sent on as `x-request-id` and orders' adopted, and no parent, so the matcher pairs it with billing's client span (P202); its tree reaches the `orders` collection |
| `billing.batches.observe.json` | @nestjs/observe `{ batches }` | three posts an hour later: two reads (200 and 404), a write that fails with the error on its root span and `e: true` below it, and twenty writes that answer 201 |
| `playwright/` | Playwright `recordHar` output (P205) | a test run's directory: an embedded full-mode HAR (with a request-API seed, a `route.fulfill` mock and a failed call), an attached minimal-mode HAR with its body files (one gone), a `.zip` HAR with its bodies, and files that are not HAR (`trace.zip`, `error-context.md`, `.last-run.json`); `expected.cli/observe.playwright*.txt` |
| `web.otlp.json` | OTLP/JSON | twenty page loads of one order (P110): the browser's request, made by `OrdersApiService.one` (`code.function`), and the gateway's answer |

The protobuf copy of `checkout.otlp.json` is written by the test's encoder at
test time, not checked in. `expected.cli/observe.json` is the observed file
over the five files `scripts/cli-snapshots.mjs` names in `TRACES` (all of the
above but the Playwright run), and the MCP snapshots in
`expected.mcp.observed/` answer from it; regenerate the CLI snapshots before
the MCP ones.

Billing's call in code (P209) is what its batch joins on its own. Read alone,
the batch's two requests to orders, from the `POST /invoices` tree and from the
message's, are that call site and its `http_calls` join, with nothing from
orders read; with `orders.observe.json` beside it, orders' snapshot of the
first is paired with billing's request by their shared `ti` and counted as the
hit on orders' `GET /orders/:param`, the join still measured on billing's side.
Both services' snapshots are snapshot 0 of that trace: each keeps its own tree
and body, because the span ids the reader makes up name the service (P222).

What traffic says of the map itself (P110). The twenty page loads go through
the one best guess traffic can single out: `OrdersApiService.one`'s request
(line 73), joined `heuristic`, beside `order`'s (line 21, `static`) of the same
route; the span names the method it ran in, which settles which call it was.
So `doctor --service web` says `1 of 4 best guesses confirmed by traffic in 2h`
(`expected.cli/doctor.observed.web.txt`) and `who_calls` on the route marks
that row `confirmedBy: "traffic"` (`expected.mcp.observed/who_calls.confirmed`).
With `GET /orders/:param` hit 22 times, the gateway's other ways in are never
seen beside a busy sibling - `strong` (`never_seen.*`, `dead.observed.txt`,
where `POST /orders/:param/cancel` turns from `unknown` to `likely-dead`) -
while `orders`, touched once a route, is `weak`, and over `since: "1h"` says
`nothing from orders in the window`. `billing`'s `GET /invoices/:id`, which the
build found nobody calls, was seen three times: `alive`, a blind spot of
static reach. The four spans that matched nothing (billing's collection twice,
the gateway's `GET /metrics`, orders' `order.audited`) are the blind-spot rows
of `expected.cli/doctor.unresolved.observed.txt` and
`expected.mcp.observed/cant_follow.seen-not-in-code`; billing's request to
orders was one of them until billing made that call in code (P209).

What the traffic answered against what the code declares (P106):
`InvoicesService` throws a `NotFoundException` in `findOne` and a
`ConflictException` in `create`, so `GET /invoices/:id` declares a 404 and
`POST /invoices` a 409. The traces answer the 404 (declared, seen), never the
409 on a route hit 22 times (declared, never seen), and a 500 from both
`POST /invoices` and `POST /orders`, whose code declares none (undeclared).
`expected.cli/doctor.observed.txt` and `expected.mcp.observed/undeclared_failures.*`,
`get_flow.failures` and `describe_for_prompt.failures` hold the answers.

## What a catalogue says of each service (P119)

`flowatlas.catalog.json` is the same project with `services[].catalog` added:
an owner, a lifecycle and the system `bookshop` for the gateway, orders and
billing, a description and a source address for two of them, and only the
system for `web`, which is how its owner and lifecycle come out `unknown` and
listed. It writes to the same `.flowatlas`, so it reads the graph
`flowatlas.config.json` built and is never built itself.

`expected.cli/export.*` hold what `flowatlas export` writes from it:

| Relation | From |
|---|---|
| `web` consumes `gateway-openapi`, and nothing else | the browser's requests join only the gateway's routes |
| `gateway` consumes `orders-openapi` and `billing-openapi` | the base-address request and the marker request |
| `billing` consumes `orders-asyncapi` and `orders-openapi` | `order.created`, which orders publishes and billing handles, and billing's call to `GET /orders/:param` (P209) |
| `gateway` depends on `resource:api.stripe.com` | the request that leaves the project |
| `orders` depends on `resource:orders` | its queries on the `orders` table |
| `invoice.requested` | consumed by billing, published by nothing: listed, consumes nothing |

The workspace holds a container per service, `orders store`, `order messages`
and `invoice messages`, the host outside, and a dynamic view per flow that
crosses containers, the browser's click first (it crosses three services).
