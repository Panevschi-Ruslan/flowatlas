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

Every outgoing call in the project is in `gateway/src/clients/`. There are five,
which is the `httpOut.total` of §12.

| Call site | file:line | Address | Links to | Confidence / `meta.via` | Bucket | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `http.get<OrderDto>(...)` | `gateway/src/clients/orders.client.ts:33` | `${ORDERS_URL}/orders/${id}` | `entry:orders:http:GET:/orders/:param` | `static` / `baseUrlEnv` | `linked` | — |
| `http.post<OrderDto>(...)` | `gateway/src/clients/orders.client.ts:44` | `${ORDERS_URL}/orders/${id}/cancel` | nothing — `orders` has `POST /orders/:param/archive`, never `cancel` | — | `noRoute` | `target-route-not-found` |
| `http.post(...)` | `gateway/src/clients/payments.client.ts:24` | `${PAYMENTS_URL}/pay` | nothing — no service declares `PAYMENTS_URL` | — | `unknownEnv` | `unknown-base-url-env` |
| `http.post<InvoiceDto>(registry.invoicesUrl(), …)` | `gateway/src/clients/billing.client.ts:33`, marker at `:31` | built at run time | `entry:billing:http:POST:/invoices` | `marker` / `marker` | `linked` + `byMarker` | — |
| `axios.post('https://api.stripe.com/v1/charges', …)` | `gateway/src/clients/payments.client.ts:34` | absolute | `external_api:api.stripe.com` (already from P03) | `static` | `external` | — |

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
| `entry:gateway:http:POST:/orders/:param/invoice` | `gateway/src/orders/orders.controller.ts:40` | nobody, `uncalled` |
| `entry:gateway:http:POST:/orders/pay` | `gateway/src/orders/orders.controller.ts:45` | nobody, `uncalled` |
| `entry:gateway:http:POST:/orders/charge` | `gateway/src/orders/orders.controller.ts:50` | nobody, `uncalled` |
| `entry:orders:http:GET:/orders/latest` | `orders/src/orders/orders.controller.ts:19` | nobody, `uncalled` — the literal half of the §10 pair |
| `entry:orders:http:GET:/orders/:param` | `orders/src/orders/orders.controller.ts:25` | `gateway`, `static` |
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
  --calls-->    orders   db_query read Order           orders.service.ts:26
  --queries-->  table:orders#Order
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
`marker-route-not-found`. Either one needs a sixth `http_out`, which would break
the `httpOut.total` of 5 that §12 fixes, so both belong in `matchRoute`'s and
the marker resolver's own unit tests.

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
— the same fault turned up four times in the project this tool was built for.

Genuine ambiguity needs two differently spelled paths that both match one client
path (`/a/:param/x` and `/a/x/:param` for a client asking `/a/x/x`), and that
pair lives in `route-match.test.ts` and `link.test.ts` rather than here, where it
would add routes §11 does not name and move the counts below.

## Expected counts (§12)

```jsonc
"httpOut":  { "total": 5, "linked": 2, "byMarker": 1, "unknownEnv": 1,
              "noRoute": 1, "ambiguous": 0, "external": 1, "dynamic": 0 }
```

`linked + unknownEnv + noRoute + ambiguous + external + dynamic == total`
(2+1+1+0+1+0 = 5); `byMarker` is the subset of `linked` that a marker resolved.

```jsonc
"channels": { "total": 3, "linked": 1,
              "noConsumers": ["channel:order.archived"],
              "noProducers": ["channel:invoice.requested"] }
```

`linked + |noConsumers| + |noProducers| == total` (1+1+1 = 3).

```jsonc
"ui":       { "total": 6, "resolved": 3, "unresolved": 3,
              "byReason": { "ambiguous-route-target": 1,
                            "api-path-partly-read": 1,
                            "target-route-not-found": 1 } }
```

`resolved + unresolved == total`, and `byReason` sums to `unresolved`: every
request the browser makes is in exactly one bucket, and every bucket but the
first says why.

```jsonc
"routes":   { "total": 12, "called": 3, "uncalled": [ /* 9 ids */ ],
              "duplicated": ["entry:orders:http:GET:/a/:param"] }
```

`duplicated` is where the `GET /a/:param` pair shows up: one entry node, two
`handles` edges, and a framework that answers with whichever controller it
registered first.

What follows from the fixture rather than from §12, and is worth asserting once
the passes exist:

- `routes`: 13 route declarations, **12** `entry` nodes with `kind: "http"` (the
  `/a/:param` pair is one node), `called: 3`, so `uncalled` has 9 ids and must
  contain `entry:billing:http:GET:/invoices/:param`.
- `types`: `OrderDto` appears once as `type:@fx/contracts#OrderDto`, with
  `meta.sharedPackage: "@fx/contracts"`, and both the `returns` of the linked
  `http_calls` edge and `orders`' handler point at that id. `Money`,
  `OrderStatus` and `CreateOrderDto` merge the same way; how many of them reach
  the registry depends on `types.maxDepth`. The browser's own `type:web#OrderDto`
  is a **second** shape of the same name on purpose: `web` declares its own copy,
  which is how a frontend and a backend drift apart and is what P10 will compare
  across the `hits` edge.
- `services[]`: four entries, all four extracted.
- 107 nodes and 88 edges, of which `web` contributes 20 nodes and 12 edges and
  the linker adds three `hits` edges, one of them `heuristic`.
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
| `@nestjs/axios`, `@nestjs/config`, `axios` | `gateway/node_modules/*` — copies of the `nest-leaves` stubs |
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

> The repository's `.gitignore` re-includes `fixtures/*/node_modules/**`, which
> is one level short of these: the stubs live at
> `fixtures/multi-repo/<repo>/node_modules/**`. Add
> `!fixtures/*/*/node_modules/` and `!fixtures/*/*/node_modules/**` to commit
> them, or the fixture only type-checks on the machine that created it.

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
