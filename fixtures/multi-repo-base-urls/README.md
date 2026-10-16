# multi-repo-base-urls

Base addresses read from the repositories' own files (P77). Four services, and
not one `baseUrlEnv` in the configuration: every request between them is rooted
at a setting nobody claims, and each one is joined by what a file at the top of
a repository says the setting is.

| Request | Setting | Where its value is | Joined to |
|---|---|---|---|
| `ShopClient.order` | `ORDERS_API` | `storefront/.env.example`: `http://orders:3000` | `orders`, by its name |
| `ShopClient.history` | `ORDERS_SERVICE_URL` | only `storefront/.env`, whose values are never read | `orders`, the one service the setting is named after |
| `ShopClient.pay` | `PAYMENTS_BASE` | `docker-compose.yml`, the container `shop` is built from `storefront` | `payments`: `payments-api` is built from it |
| `ShopClient.refund` | `LEDGER_URL` | the code's own fallback, `http://localhost:4000` | `payments`: `payments-api` publishes port 4000 |
| `ShopClient.rates` | `SHIPPING_URL` | `storefront/.env.example`: a host outside the project | the third party `api.shipping.example.com` |
| `ShopClient.stock` | `INVENTORY_URL` | only `storefront/.env` | nothing: an `unknown-base-url-env` row that says so |
| `ShopClient.products` | `catalog.url` | `src/catalog.config.ts`: `CATALOG_URL`, falling back to `http://catalog:3002` | `catalog` |
| `PaymentsController.pay` | `ORDERS_API` | `payments/serverless.yml` | `orders` |
| `ProductsController.list` | `ORDERS_FEED_URL` | `catalog/wrangler.toml` `[vars]`: `http://localhost:3001` | `orders`: its `.env.example` runs it on 3001 |

Every join is `heuristic` and carries `baseUrl` and `baseUrlFrom`, on the edge
and on the request; each value taken is one `base-url-from-files` (or
`base-url-from-name`) row at level `info`.

What is never kept, and the snapshot proves by not holding it: anything in
`storefront/.env` but the names; `API_KEY`, whose name says it is a secret; the
credentials and the query in `AUDIT_URL`; `DATABASE_URL`, which is not an
address a request is sent to; the database container's password.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/multi-repo-base-urls/flowatlas.config.json
```
