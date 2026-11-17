# claimants-nested-chain-env-port fixture

Four things P313 left open, read by P319.

## A setting several services claim

`orders` and `legacy` both claim `ORDERS_URL`. `jobs` builds requests on
`process.env.ORDERS_URL` alone. Each claimant is asked whether it serves the
request.

| Request | Joins |
|---|---|
| `GET ${ORDERS_URL}/v1/orders` | legacy `GET /v1/orders`, `heuristic`, `chosenAmong` naming both claims (before P319: `unknown-base-url-env`, declared on both) |
| `GET ${ORDERS_URL}/status` | nothing: both serve it, an `ambiguous-route-target` row, "a setting several services claim" (before P319: `unknown-base-url-env`) |
| `GET ${ORDERS_URL}/nowhere` | nothing: nobody serves it, `unknown-base-url-env` naming both, as before |

## A chain after a condition

`(isProd ? process.env.CATALOG_URL : process.env.STOCK_URL) ||
process.env.ARCHIVE_URL`: the branches are one tier, `ARCHIVE_URL` the tier
read after it, as in a plain chain.

| Request | Joins |
|---|---|
| `GET ${shelfBase()}/products` | catalog `GET /products`, `heuristic`, a branch's service, as before |
| `GET ${shelfBase()}/exports` | archive `GET /exports`, `heuristic`, `chosenAmong` naming all three (before P319: `target-route-not-found` against catalog) |

## A fallback port a file gives another value

`api` listens on `process.env.API_PORT ?? 3000`, and its `.env.development`
sets `API_PORT=4000`. The service is heard at 4000, `listensAt` naming the
file; a run with the file never listens on 3000.

| Request | Joins |
|---|---|
| `GET http://localhost:4000/items` | api `GET /items`, `heuristic`, `listensAt: src/app.ts:13 (API_PORT from .env.development)` (before P319: a third party, nothing heard at 4000) |
| `GET http://localhost:3000/items` | a third party: nothing listens at 3000 (before P319: api, the fallback a guess) |

## A firm port and a guess at the same number

`audit` writes `listen(3100)`; `reports` falls back to 3100 where `PORT` is
not given, and nothing gives it. The written port is the port's outright.

| Request | Joins |
|---|---|
| `GET http://localhost:3100/audit/log` | audit `GET /audit/log`, `static` (before P319: `local-port-shared` naming both) |

## Expected

```
calls out: 8 total, 5 linked, 1 third party, 1 unknown env, 1 ambiguous
```
