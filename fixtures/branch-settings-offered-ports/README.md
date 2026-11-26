# branch-settings-offered-ports fixture

Two things P309 reads as candidates rather than answers.

## A condition's branches over settings different services claim

`jobs` builds its orders requests on `isProd ? process.env.ORDERS_URL :
process.env.LEGACY_URL`. `orders` claims `ORDERS_URL` and `legacy` claims
`LEGACY_URL`, so the request's base is one of two services, and nothing
written says which. The request carries every branch's setting
(`baseUrlEither`), and the linker asks each branch's service whether it
serves the request.

| Request | Joins |
|---|---|
| `GET ${ordersBase()}/orders/open` | orders `GET /orders/open`, `heuristic`, `chosenAmong` naming both branches |
| `GET ${ordersBase()}/archive` | legacy `GET /archive`, `heuristic` (before P309: `target-route-not-found` against orders) |
| `GET ${ordersBase()}/health` | nothing: both serve it, an `ambiguous-route-target` row naming each |
| `GET ${ordersBase()}/nowhere` | nothing: neither serves it, `target-route-not-found` against orders, the first branch's, as before |

## A port an example environment file offers

`api` listens on `process.env.PORT` with no fallback, and its `.env.example`
writes `PORT=3000`, the port the shop's Next assumes. An example file is
written to be copied and filled in, so the port is offered, not given: a
guess, as a framework's default and a port read through a merge are (P307).

| Request | Joins |
|---|---|
| `GET http://localhost:3000/api/cart` | the shop's `GET /api/cart`: the shop serves it, and the offer takes no request from a service that serves it (before P309: `target-route-not-found` against api) |
| `GET http://localhost:3000/items` | api `GET /items`, which it serves |
| `GET http://localhost:3000/stray` | nothing serves it: the offered port outranks the default, so it is `target-route-not-found` against api |
