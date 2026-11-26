# client-instance-base fixture

Two NestJS services that serve the same two routes, and three front ends that
reach them through client instances (P239). The route alone names neither
service, so every request here is ambiguous by its route; the only thing that
says which service is meant is the base the instance was made with. That is
the point of the fixture: the base is read where the instance is made and put
in front of the address the graph records, so the request joins the service at
that base, `static`.

| Service | Type | What it is |
|---|---|---|
| `orders` | nestjs | `GET /items`, `POST /items` |
| `billing` | nestjs | the same two routes; `hosts: ["billing.example.test"]` |
| `shop` | react | axios, ky and ofetch instances |
| `admin` | vue | an axios instance given its base afterwards, and `$fetch.create` |
| `console` | angular | an interceptor putting `environment.apiUrl` in front of every request |

`shop` and `admin` name `VITE_ORDERS_URL` and `VITE_BILLING_URL` under
`apiTarget`; `console` names `apiUrl` as the orders service.

## Requests

| Where | How the instance is made | Address recorded | Joins | Before P239 |
|---|---|---|---|---|
| `shop` `Items.tsx:7` | `axios.create({ baseURL: import.meta.env.VITE_ORDERS_URL })` | `GET ${VITE_ORDERS_URL}/items` | orders, `static`, `api-target` | `GET /items`, ambiguous |
| `shop` `Items.tsx:8` | the same instance | `POST ${VITE_ORDERS_URL}/items` | orders, `static`, `api-target` | `POST /items`, ambiguous |
| `shop` `Items.tsx:9` | `ky.create({ prefixUrl: BILLING_HOST })`, a constant from `config.ts`, default-exported | `GET https://billing.example.test/items` | billing, `static`, `host` | not read (ky was no client) |
| `shop` `Items.tsx:10` | `ofetch.create({ baseURL: import.meta.env.VITE_BILLING_URL })`, called as a function | `POST ${VITE_BILLING_URL}/items` | billing, `static`, `api-target` | not read (the instance was a local name) |
| `shop` `Items.tsx:11` | `axios.create({ baseURL: localStorage.getItem('api-base') ?? '' })` | `GET /items` | nothing: `ambiguous-route-target` | the same |
| `admin` `ItemsView.vue:12` | `axios.create()`, then `api.defaults.baseURL = import.meta.env.VITE_ORDERS_URL` in `main.ts` | `GET ${VITE_ORDERS_URL}/items` | orders, `static`, `api-target` | `GET /items`, ambiguous |
| `admin` `ItemsView.vue:13` | `$fetch.create({ baseURL: import.meta.env.VITE_BILLING_URL })` | `POST ${VITE_BILLING_URL}/items` | billing, `static`, `api-target` | not read |
| `console` `items.service.ts:15` | `req.clone({ url: `${environment.apiUrl}${req.url}` })`, behind `if (req.url.startsWith('http'))` | `GET ${apiUrl}/items`, `baseFrom: interceptor` | orders, `static`, `api-target` | `GET /items`, ambiguous |
| `console` `items.service.ts:19` | the same interceptor | `POST ${apiUrl}/items` | orders, `static`, `api-target` | `POST /items`, ambiguous |

The billing host joins through `services[].hosts`: the code names the host, the
configuration says whose it is, and the request is no third party, so the
`external_api` node the reader drew for it is not in the graph.

`legacyApi` is the honest case. Its base is chosen at run time, so one row says
so at the line that makes the instance (`api-client-base-unread`,
`shop/src/api/legacy.ts:4`), the request keeps the path it writes, and the join
stays what the route alone can say: two services answer it.

## Expected

```
ui calls: 9 total, 8 joined to a route, 1 not (ambiguous-route-target 1)
routes:   4 total, 4 reached, 0 never called
```

Before P239 the same tree read six requests and joined none (six
`ambiguous-route-target` rows); the three through ky and ofetch were not read.

`node_modules` in `shop`, `admin` and `console` hold hand-written stubs in the
libraries' shapes. The instances are told apart by the import their factory is
called on, so nothing here needs them for the reading; they are there for the
type checker.

Extracted, from the repository root:

```
pnpm flowatlas build --config fixtures/client-instance-base/flowatlas.config.json
```
