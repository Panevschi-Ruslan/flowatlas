# proxy-chain-joins fixture

The proxy rules P257 left as rows, read (P260): a Vite key written as a
regular expression, a rewrite that is any regular expression replaced by a
literal, a target read from a setting the service's own files fill, an
http-proxy-middleware `router`, a request a proxy forwards to another proxy,
and a Next server's own requests with no host.

| Service | Type | Forwards |
|---|---|---|
| `orders` | express | listens on 3001: `GET /orders`, `GET /orders/:id` |
| `catalog` | express | listens on 3003: `GET /products`, `GET /products/:id` |
| `billing` | express | listens on 3004: `GET /invoices` |
| `ledger` | express | listens on 3006: `GET /v2/invoices` |
| `gateway` | nextjs on 3020 | `next.config.js:5` `/orders/:path*` to `` `${process.env.ORDERS_URL}/orders/:path*` ``, after its own files; `.env.example` gives `ORDERS_URL=http://localhost:3001`; its own `app/api/health/route.ts` |
| `web` | react, Vite on 5180 | `vite.config.ts:11` `/api` to `env.VITE_GATEWAY_URL` (of `loadEnv`; `.env.example` gives `http://localhost:3020`), prefix taken off; `:12` `^/legacy/.*` to catalog, `/legacy` taken off; `:13` `/v2` to catalog, `^/v2/catalog` taken off the whole path; `:14` `/loop` to kiosk |
| `kiosk` | react, Vite on 5190 | `vite.config.ts:7` `/shop` to web's dev server, prefix taken off; `:8` `/loop` to web's |
| `admin` | angular | `proxy.conf.json:2` `/billing` to billing with `pathRewrite: { '^/billing': '' }` and a `router` sending `/billing/v2` to ledger (`:8`), and one key by host (`:9`), a row |
| `jobs` | express | calls kiosk's dev server |

## Requests

| Where | Request | Joins | Before P260 |
|---|---|---|---|
| `web` `Shop.tsx:3` | `/api/orders/7` | orders `GET /orders/:param` through web's proxy and then gateway's rewrite: `proxiedBy: vite.config.ts:11`, `proxiedThen: [next.config.js:5]`, `proxiedAs: /orders/7`, `proxiedTo: ORDERS_URL from .env.example` | `target-route-not-found` |
| `web` `Shop.tsx:4` | `/legacy/products` | catalog `GET /products` by the pattern key | `target-route-not-found` |
| `web` `Shop.tsx:5` | `/v2/catalog/products/1` | catalog `GET /products/:param`, the whole path rewritten | `target-route-not-found` |
| `web` `Shop.tsx:6` | `/loop/ping` | nothing: `proxy-chain-unfollowed`, web forwards to kiosk and kiosk back to web | `target-route-not-found` at kiosk |
| `kiosk` `Kiosk.tsx:3` | `/shop/api/orders/7` | orders through kiosk, web and gateway: `proxiedThen: [vite.config.ts:11, next.config.js:5]` | `target-route-not-found` at web |
| `jobs` `server.ts:7` | `http://localhost:5190/shop/api/orders/7` | orders, as `Kiosk.tsx:3` | `target-route-not-found` at web |
| `admin` `invoices.service.ts:11` | `/billing/invoices` | billing `GET /invoices` | the same |
| `admin` `invoices.service.ts:15` | `/billing/v2/invoices` | ledger `GET /v2/invoices` by the router, `proxiedBy: proxy.conf.json:8` | `target-route-not-found` at billing |
| `gateway` `page.tsx:3` | `/api/health`, read by the server half | gateway's own route, `via: ownOrigin` (and by the browser's reading, `same-service`, as before) | `dynamic` |
| `gateway` `page.tsx:4` | `/orders/today`, read by the server half | orders through gateway's rewrite, `proxiedTo: ORDERS_URL from .env.example` (and by the browser's reading, the same) | `dynamic`; the browser's reading by its route alone |

## Expected

```
calls out: 3 total, 3 linked
ui calls: 9 total, 8 joined, 1 proxy-chain-unfollowed
rows: proxy-rule-unread at admin proxy.conf.json:9 (a router key by host)
```

Measured with the tool at the commit before P260 over the same tree:

```
calls out: 3 total, 0 linked, 1 noRoute, 2 dynamic
ui calls: 9 total, 3 joined (two by route or same service), 6 target-route-not-found
rows: proxy-rule-unread at gateway next.config.js:5, web vite.config.ts:11, :12 and :13
```
