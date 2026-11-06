# client-interceptor-base fixture

Two NestJS services that serve the same two routes, a third that calls one of
them by its host, and a React front end whose clients get their base from a
function run before every request (P244). The route alone names neither
service, so every browser request here is ambiguous by its route; the only
thing that says which service is meant is what the interceptor or hook puts in
front of the address. The function is read where it is written and every
request through that client is recorded under the base it sets, so the request
joins the service at that base, `static`.

`fixtures/client-instance-base` (P239) is the same shape with the base written
where the instance is made; this one is the base written one step later.

| Service | Type | What it is |
|---|---|---|
| `orders` | nestjs | `GET /items`, `POST /items` |
| `billing` | nestjs | the same two routes; `hosts: ["billing.example.test"]` |
| `reports` | nestjs | `fetch` to billing's host and to a third party |
| `shop` | react | axios, ofetch and ky clients whose base a function sets |

`shop` names `VITE_ORDERS_URL` and `VITE_BILLING_URL` under `apiTarget`.

## Requests

| Where | What sets the base | Address recorded | Joins | Before P244 |
|---|---|---|---|---|
| `shop` `Items.tsx:9` | `ordersApi.interceptors.request.use((config) => { config.baseURL = import.meta.env.VITE_ORDERS_URL; … })` | `GET ${VITE_ORDERS_URL}/items` | orders, `static`, `api-target` | `GET /items`, ambiguous |
| `shop` `Items.tsx:10` | the same, called with one config object, `ordersApi({ url, method: 'post', data })` | `POST ${VITE_ORDERS_URL}/items` | orders, `static`, `api-target` | not read (a config call) |
| `shop` `Items.tsx:11` | `ofetch.create({ onRequest({ options }) { options.baseURL = import.meta.env.VITE_BILLING_URL } })` | `GET ${VITE_BILLING_URL}/items` | billing, `static`, `api-target` | `GET /items`, ambiguous |
| `shop` `Items.tsx:12` | ky `hooks.beforeRequest` answering `` new Request(`${BILLING_HOST}${new URL(request.url).pathname}`, request) `` | `POST https://billing.example.test/items` | billing, `static`, `host` | `POST items`, ambiguous |
| `shop` `Items.tsx:13` | `axios.interceptors.request.use(...)` on the module, `config.url = import.meta.env.VITE_BILLING_URL + config.url` behind an "is it absolute" guard; called as `axios.request({ url })` | `GET ${VITE_BILLING_URL}/items` | billing, `static`, `api-target` | not read (a config call) |
| `shop` `Items.tsx:14` | an interceptor answering `{ ...config, baseURL: isStaff() ? ORDERS : BILLING }` | `GET /items` | nothing: `ambiguous-route-target` | the same |
| `reports` `reports.controller.ts:12` | `fetch('https://billing.example.test/items')` | `GET https://billing.example.test/items` | billing, `static`, `host` | third party |
| `reports` `reports.controller.ts:18` | `fetch('https://payments.example.test/charge', { method: 'POST' })` | `POST https://payments.example.test/charge` | third party | the same |

Every joined browser request carries `baseFrom: "interceptor"`. The billing host
joins through `services[].hosts`, from the browser and from `reports` alike: the
code names the host, the configuration says whose it is, so the request is no
third party and the `external_api` node the readers drew for it is not in the
graph. `payments.example.test` is nobody's, and stays.

`legacyApi` is the honest case. Its interceptor picks one of two bases by a
branch, so one row says so at the line that writes it (`api-client-base-unread`,
`shop/src/api/legacy.ts:11`), the request keeps the base the instance was made
with (none), and the join stays what the route alone can say: two services
answer it.

## Expected

```
calls out: 2 total, 1 linked, 1 third party
ui calls: 6 total, 5 joined to a route, 1 not (ambiguous-route-target 1)
routes:   6 total, 4 reached, 2 never called
```

The two routes never called are `reports`'s own, which nothing here requests.

Measured with the tool at the commit before P244 over the same tree: four
browser requests read, none joined (four `ambiguous-route-target` rows), the two
config calls not read at all; both of `reports`'s requests third parties.

`node_modules` in `shop` holds hand-written stubs in the libraries' shapes. The
clients are told apart by the import their factory is called on, so nothing
here needs them for the reading; they are there for the type checker.

Extracted, from the repository root:

```
pnpm flowatlas build --config fixtures/client-interceptor-base/flowatlas.config.json
```
