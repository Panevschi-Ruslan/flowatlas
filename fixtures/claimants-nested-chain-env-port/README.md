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
sets `API_PORT=4000`. Nothing in `api`'s code or scripts is read loading the
file, so its value is offered beside the fallback, both guesses, each asked
whether it serves the request (P325; P319 had placed the service at 4000
firmly and dropped the fallback).

| Request | Joins |
|---|---|
| `GET http://localhost:4000/items` | api `GET /items`, `heuristic`, `listensAt: src/app.ts:13 (API_PORT from .env.development) (a file nothing is read loading)` (before P319: a third party, nothing heard at 4000) |
| `GET http://localhost:3000/items` | api `GET /items`, `heuristic`, `listensAt: src/app.ts:13 (API_PORT)`, the fallback a guess (P325; under P319 a third party) |

## A firm port and a guess at the same number

`audit` writes `listen(3100)`; `reports` falls back to 3100 where `PORT` is
not given, and nothing gives it. The written port is the port's outright.

| Request | Joins |
|---|---|
| `GET http://localhost:3100/audit/log` | audit `GET /audit/log`, `static` (before P319: `local-port-shared` naming both) |

## Expected

```
calls out: 8 total, 6 linked, 1 unknown env, 1 ambiguous
```
