# listen-port-joins fixture

Nine services run on one machine, and the requests between them name each
other by port: `http://localhost:3001/orders`, `http://127.0.0.1:3003/products`,
`http://0.0.0.0:3002/stock/ABC-1`. Nothing in the configuration says which
service is on which port. The code that starts each server does (P250): the
port is read where the server is started, kept on the service's repository
node (`meta.listen`), and a request to that port on this machine joins the
service listening there, `via: host`, with `meta.listensAt` on the edge.

A port the code writes as a number joins `static`. One that is a setting's
fallback (`Number(process.env.PORT) || 3002`) is where a local run listens,
and joins `heuristic`. Two services on one port is a row, `local-port-shared`.

It also holds the two hook spellings P250 reads: a Nuxt `useFetch` whose own
`onRequest` sends that one call to another service, and two ky hooks that
build the address by replacing the page's origin and by resolving the old
path against another server.

| Service | Type | Listens on | Read from |
|---|---|---|---|
| `orders` | express | 3001 | `src/app.ts:16`, `app.listen(PORT)` with `const PORT = 3001` |
| `stock` | fastify | 3002 | `src/app.ts:15`, `listen({ port })`, `port = Number(process.env.PORT) \|\| 3002` (a fallback) |
| `catalog` | hono | 3003 | `src/server.ts:9`, `serve({ fetch: app.fetch, port: 3003 })` from `@hono/node-server` |
| `ledger` | nestjs | 3005 | `src/main.ts:8`, `await app.listen(3005)` |
| `audit` | koa | 3005 | `.env.example` `PORT=3005` (the code reads `process.env.PORT` with no fallback) |
| `storefront` | nuxt | 3010 | `nuxt.config.ts:3`, `devServer: { port: 3010 }` |
| `admin` | nextjs | 3020 | `package.json:6`, `"dev": "next dev -p 3020"` |
| `jobs` | nestjs | 3009 | `src/main.ts:7`, `process.env.PORT ?? 3009` (a fallback) |
| `web` | react | — | a browser |

`orders` and `stock` both serve `GET /health`; `ledger` and `audit` both serve
`GET /entries`.

## Requests

| Where | Request | Joins | Before P250 |
|---|---|---|---|
| `web` `Dashboard.tsx:7` | `fetch('http://localhost:3001/orders')` | orders, `static`, `listensAt: src/app.ts:16` | orders by its route alone (`unique-route`, `heuristic`), and a third party `localhost:3001` |
| `web` `Dashboard.tsx:8` | `fetch('http://localhost:3001/health')` | orders, `static` | nothing: `ambiguous-route-target` (orders and stock) |
| `web` `Dashboard.tsx:9` | `axios.get('http://127.0.0.1:3003/products')` | catalog, `static` | `unique-route`, `heuristic`, and a third party |
| `web` `Dashboard.tsx:10` | `fetch('http://localhost:3005/entries')` | nothing: `local-port-shared`, naming `audit (its setting files)` and `ledger (src/main.ts:8)` | audit, `heuristic`, by its example environment file alone |
| `web` `Dashboard.tsx:11` | `fetch('http://localhost:3020/api/reports')` | admin, `static`, `listensAt: package.json:6` | `unique-route`, `heuristic`, and a third party |
| `web` `Dashboard.tsx:12` | `stockApi.get('ABC-1')`, a ky hook answering `new Request(request.url.replace(window.location.origin, 'http://localhost:3002'), request)` under `prefixUrl: '/stock'` | `GET http://localhost:3002/stock/ABC-1`, stock, `heuristic` (the port is a fallback) | `GET /stock/ABC-1`, `unique-route`, and `api-client-base-unread` at `api.ts:10` |
| `web` `Dashboard.tsx:13` | `basketApi.get('basket')`, a ky hook answering `new Request(new URL(url.pathname, 'http://localhost:3010'), request)` under `prefixUrl: '/api'` | `GET http://localhost:3010/api/basket`, storefront, `static` | `GET /api/basket`, `unique-route`, and `api-client-base-unread` at `api.ts:21` |
| `storefront` `pages/index.vue:14` | `useFetch('/products', { onRequest({ options }) { options.baseURL = 'http://localhost:3003' } })` | `GET http://localhost:3003/products` (`baseFrom: call-hook`), catalog, `static` | `GET /products`, `unique-route`, `heuristic` |
| `storefront` `pages/index.vue:21` | `$fetch('/api/basket')`, no hook | its own route, `same-service` | the same |
| `jobs` `sync.controller.ts:12` | `fetch('http://0.0.0.0:3002/stock/ABC-1')` | stock, `heuristic`, `listensAt: src/app.ts:15 (PORT)` | a third party `0.0.0.0:3002` |
| `jobs` `sync.controller.ts:18` | `fetch('http://localhost:4999/health')` | a third party: nothing listens on 4999 | the same |

Every join made by a port carries `via: host` and `listensAt`. The third-party
nodes the readers drew for `localhost:3001`, `127.0.0.1:3003`, `localhost:3020`,
`localhost:3005` and `0.0.0.0:3002` are gone: each is one of the project's own
services, or two of them. `localhost:4999` stays.

## Expected

```
calls out: 2 total, 1 linked, 1 third party
ui calls: 9 total, 8 joined to a route, 1 not (local-port-shared 1)
routes:   11 total, 6 reached, 5 never called
```

Measured with the tool at the commit before P250 over the same tree:

```
calls out: 2 total, 0 linked, 2 third party
ui calls: 9 total, 8 joined to a route, 1 not (ambiguous-route-target 1)
```

eight browser requests joined, six of them by route alone (`heuristic`) and
one to the wrong service of two (`audit`, by its environment file, though
`ledger` starts its server on the same port); both ky hooks rows; four third
parties that are the project's own services. After: every browser join but
`stock`'s is `static`, the one the reader cannot settle is a row naming both
services, and the server request reaches stock.
