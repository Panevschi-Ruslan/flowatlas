# chain-candidates-written-fallback fixture

Three more things P313 reads as candidates rather than answers.

## A chain's later settings

`jobs` builds its orders requests on `process.env.ORDERS_URL ||
process.env.LEGACY_URL`. `orders` claims `ORDERS_URL`; `legacy` and
`archive` both claim `LEGACY_URL`. Where the first setting's service serves
the request the join is the one it always was; where it does not, each later
setting's claimants are asked in order.

| Request | Joins |
|---|---|
| `GET ${ordersBase}/orders/open` | orders `GET /orders/open`, `static`, as before |
| `GET ${ordersBase}/archive` | legacy `GET /archive`, `heuristic`, `chosenAmong` naming each claim (before P313: `target-route-not-found` against orders) |
| `GET ${ordersBase}/status` | nothing: legacy and archive, the second setting's claimants, both serve it, an `ambiguous-route-target` row naming each (before P313: `target-route-not-found` against orders) |
| `GET ${ordersBase}/nowhere` | nothing: nobody serves it, `target-route-not-found` against orders, as before |

## A condition's branch setting several services claim

`isProd ? process.env.ORDERS_URL : process.env.LEGACY_URL`, with
`LEGACY_URL` claimed by two services. P309 skipped such a setting; every
claimant is a candidate now.

| Request | Joins |
|---|---|
| `GET ${exportBase()}/exports` | archive `GET /exports`, `heuristic` (before P313: `target-route-not-found` against orders) |

## Keys a settings factory builds from variables

`portal` reads `this.config.get('orders.url')`, and `settings.ts` builds
`orders.url` from `ORDERS_URL` and `legacy.url` from `LEGACY_URL`. The
variable of every key after the first is written (`baseUrlVariables`) and
looked up as the first's is.

| Request | Joins |
|---|---|
| `GET ${orders.url \|\| legacy.url}/archive` | legacy `GET /archive`, `heuristic`, through `LEGACY_URL` (before P313: `target-route-not-found` against orders) |
| `GET ${isProd ? orders.url : legacy.url}/exports` | archive `GET /exports`, `heuristic` (before P313: `target-route-not-found` against orders) |

## A written fallback port

`api` listens on `process.env.PORT ?? 3000`, and nothing in the repository
sets `PORT`; the shop's Next assumes 3000 too. The fallback is what the code
assumes where nothing sets the setting: a guess, asked whether it serves the
request like the framework's default, and outranking it where nobody does.

| Request | Joins |
|---|---|
| `GET http://localhost:3000/api/cart` | the shop's `GET /api/cart`, which it serves (before P313: `target-route-not-found` against api) |
| `GET http://localhost:3000/items` | api `GET /items`, which it serves |
| `GET http://localhost:3000/stray` | nothing serves it: the fallback outranks the default, `target-route-not-found` against api |
