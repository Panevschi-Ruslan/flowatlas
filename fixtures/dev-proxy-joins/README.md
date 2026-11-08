# dev-proxy-joins fixture

Front ends that call their own server with no host, and servers that forward a
prefix of their paths to another service (P257): Vite's `server.proxy`, an
Angular dev server's proxy configuration, Nitro's `devProxy` and a Nuxt route
rule's `proxy`, Next's `rewrites()`, and Create React App's `"proxy"`. Each
rule is read where the framework writes it, kept on the repository node
(`meta.proxy`), and a request it forwards joins the service at the target's
host at the rewritten path: `via: proxy`, `heuristic`, with `proxiedBy` (the
rule's `file:line`), `proxiedAs` (the path it is forwarded as, where it
changes) and the target's `listensAt`.

| Service | Type | Forwards |
|---|---|---|
| `orders` | express | listens on 3001: `GET /orders`, `GET /orders/:id` |
| `catalog` | express | listens on 3003: `GET /products` |
| `billing` | express | listens on 3004: `GET /invoices` |
| `web` | react, Vite on 5180 | `vite.config.ts:9` `/api` to orders with the prefix taken off (`rewrite: (path) => path.replace(/^\/api/, '')`); `:14` `/products` to catalog; `:15` `/rates` to a third party; `:16` a pattern key and `:17` a target from a setting, not read |
| `legacy` | react (Create React App) | `package.json:8` `"proxy"`: everything to billing, after its own files |
| `admin` | angular | `angular.json` `proxyConfig: proxy.conf.json`; `proxy.conf.json:2` `/billing` to billing with `pathRewrite` taking it off; `:9` a rewrite that is a pattern, not read |
| `storefront` | nuxt | `nuxt.config.ts:3` route rule `'/orders-api/**': { proxy: 'http://localhost:3001/**' }`; `:7` `nitro.devProxy` `/catalog` to catalog (mounted, so the prefix is taken off) |
| `store` | nextjs | `next.config.js:5` `rewrites()` `/shop-api/:path*` to orders, after its own files; `/old-home` to `/`, a rewrite inside the application and no proxy |
| `jobs` | express | calls web's dev server |

## Requests

| Where | Request | Joins | Before P257 |
|---|---|---|---|
| `web` `Shop.tsx:3` | `/api/orders` | orders `GET /orders`, `proxiedBy: vite.config.ts:9`, `proxiedAs: /orders` | `target-route-not-found` |
| `web` `Shop.tsx:4` | `/api/orders/${id}` | orders `GET /orders/:param` | `target-route-not-found` |
| `web` `Shop.tsx:5` | `/products` | catalog, `proxiedBy: vite.config.ts:14` | catalog by its route alone (`unique-route`) |
| `web` `Shop.tsx:6` | `/rates/today` | a third party `rates.example.test`, `via: proxy`; note `proxied-to-third-party` | `target-route-not-found` |
| `web` `Shop.tsx:7` | `/api/returns` | `target-route-not-found`: orders has no `GET /returns` | `target-route-not-found`, no service named |
| `web` `Shop.tsx:8` | `localhost:5180/api/orders`, its own dev server | orders, as line 3; no third party for `localhost:5180` | `target-route-not-found`, and a third party |
| `legacy` `Invoices.tsx:3` | `/invoices` | billing, `proxiedBy: package.json:8` | billing by its route alone |
| `admin` `invoices.service.ts:11` | `/billing/invoices` | billing `GET /invoices`, `proxiedBy: proxy.conf.json:2` | `target-route-not-found` |
| `storefront` `index.vue:9` | `useFetch('/catalog/products')` | catalog `GET /products`, `proxiedBy: nuxt.config.ts:7` | `target-route-not-found` |
| `storefront` `index.vue:12` | `$fetch('/orders-api/orders')` | orders `GET /orders`, `proxiedBy: nuxt.config.ts:3` | `target-route-not-found` |
| `store` `page.tsx:5` | `/shop-api/orders` | orders `GET /orders`, `proxiedBy: next.config.js:5` | `target-route-not-found` |
| `store` `page.tsx:6` | `/shop-api/health` | store's own route, which Next serves before its rewrites | the same |
| `jobs` `server.ts:7` | `localhost:5180/api/orders` | orders through web's proxy; no third party for `localhost:5180` | a third party `localhost:5180` |
| `jobs` `server.ts:8` | `localhost:5180/rates/today` | the third party `rates.example.test` through web's proxy | a third party `localhost:5180` |

The server half of the Next reader reads `page.tsx`'s two relative requests as
requests from the server too, with no host to place them, as it did before
(`dynamic`).

## Expected

```
calls out: 4 total, 1 linked, 1 third party, 2 dynamic
ui calls: 12 total, 10 joined to a route, 1 proxied-to-third-party, 1 target-route-not-found
rows: proxy-rule-unread at vite.config.ts:16, vite.config.ts:17 and proxy.conf.json:9
```

Measured with the tool at the commit before P257 over the same tree:

```
calls out: 4 total, 0 linked, 2 third party (localhost:5180), 2 dynamic
ui calls: 12 total, 3 joined to a route (two by route alone), 9 target-route-not-found
```
