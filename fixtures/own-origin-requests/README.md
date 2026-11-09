# own-origin-requests fixture

A server's own requests with no host (P263): a Next route handler and a Nitro
route asking `fetch('/api/orders')`, which throws on the server as written,
and Nitro's `$fetch('/api/orders')`, which Nitro answers from its own routes in
process.

| Service | Type | What it writes |
|---|---|---|
| `site` | nextjs | `app/api/orders/route.ts` (`GET /api/orders`); `app/api/report/route.ts`, a route handler calling `fetch('/api/orders')`; `app/page.tsx`, a page both halves read, calling the same |
| `shop` | nuxt | `server/api/orders.get.ts`; `server/api/summary.get.ts` calling `$fetch('/api/orders')` and `$fetch('/catalog/items')`, which `nuxt.config.ts`'s route rule `'/catalog/**': { proxy: 'http://localhost:3003/**' }` forwards; `server/api/legacy.get.ts` calling `fetch('/api/orders')`; `server/api/remote.get.ts` calling `$fetch('/items', { baseURL })` (not read: its base is the run's) and `ofetch('/api/orders')` imported from `ofetch` |
| `catalog` | express | listens on 3003: `GET /items` |

## Requests

| Where | Request | Joins | Before P263 |
|---|---|---|---|
| `site` `app/api/report/route.ts:3` | `fetch('/api/orders')` | site's own route `via: ownOrigin`, `heuristic`, and the finding `server-request-without-origin` (the file is a route handler: the server runs it, whatever else reads it) | the join, nothing said |
| `site` `app/page.tsx:3` | `fetch('/api/orders')` | the same join, no finding: the browser makes the same request in the same place | the same |
| `shop` `server/api/summary.get.ts:3` | `$fetch('/api/orders')` | shop's own route `via: inProcess`, `static` | not read |
| `shop` `server/api/summary.get.ts:4` | `$fetch('/catalog/items')` | catalog `GET /items` through the route rule, `proxiedBy: nuxt.config.ts:3`, `proxiedAs: /items` | not read |
| `shop` `server/api/legacy.get.ts:3` | `fetch('/api/orders')` | shop's route `via: ownOrigin`, and `server-request-without-origin` | `dynamic` |
| `shop` `server/api/remote.get.ts:6` | `ofetch('/api/orders')` | the same as `fetch` | not read |

## Expected

```
calls out: 6 total, 6 linked
ui calls: 2 total, 2 joined (the browser's reading of site's two files, same-service)
rows: server-request-without-origin at site app/api/report/route.ts:3,
      shop server/api/legacy.get.ts:3 and server/api/remote.get.ts:6
```

Measured with the tool at the commit before P263 over the same tree:

```
calls out: 3 total, 2 linked, 1 dynamic
ui calls: 2 total, 2 joined
rows: no finding
```
