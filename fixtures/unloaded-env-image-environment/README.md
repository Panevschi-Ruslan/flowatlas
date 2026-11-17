# unloaded-env-image-environment fixture

What P325 left open, read by P331: a port a file nothing loads gives on this
machine, a container's image nothing in the project builds, compose run
with `--env-file`, and a cluster's workload whose image the project builds.

## A port a file nothing is read loading gives

`api` listens on `process.env.PORT` alone, and its `.env.development` sets
`PORT=4050`; nothing in `api` loads the file. `bare`'s `.env.development`
sets `PORT=4100` and its server is started nowhere the reader follows.
`audit` writes `listen(4100)`. `loaded` loads its `.env.development`
(`PORT=4200`) with dotenv before it listens.

| Request | Joins |
|---|---|
| `GET http://localhost:4050/items` | api `GET /items`, `heuristic`, `listensAt: src/app.ts:9 (PORT from .env.development) (a file nothing is read loading)`: offered, as an example's value is (before P331: the same service, placed firmly) |
| `GET http://localhost:4050/nowhere` | nothing: api is still the only service offered there, a `target-route-not-found` row against it |
| `GET http://localhost:4100/audit/log` | audit `GET /audit/log`, `listensAt: src/app.ts:9`: its written port is the port's outright, bare's file only offers it (before P331: `local-port-shared` naming both) |
| `GET http://localhost:4100/things` | nothing: audit is at 4100 firmly, so the request is audit's, a `target-route-not-found` row; bare's offer yields to it |
| `GET http://localhost:4200/stuff` | loaded `GET /stuff`, `listensAt: src/app.ts:12 (PORT from .env.development)`: the file the code loads places it firmly |

## A container's image

`orders` runs `registry.example.test/shop/orders:1.2`, which nothing in the
project builds; `stock` runs `stock-api:dev`, which stock's `Makefile`
builds with `docker build -t stock-api -f docker/Dockerfile .`, whose `ENV
PORT=4300` is the container's port.

| Request | Joins |
|---|---|
| `GET http://localhost:8080/orders` | orders `GET /orders`, by the mapping, with an info `container-image-unread` row saying the image's environment is not read and the port there is taken as 3000, beside the `published-port-unheard` row (before P331: the second row alone) |
| `GET http://localhost:8081/levels` | stock `GET /levels`, `listensAt: src/app.ts:9 (PORT from stock/docker/Dockerfile (stock)), published as 8081 by docker-compose.yml` (before P331: joined by the file alone, with `published-port-unheard`, the image's environment unread) |

## Compose run with `--env-file`

The root `Makefile` runs `docker compose --env-file compose.env up`, so the
compose file's placeholders are filled from `compose.env`, not from a
`.env` beside it: `${BILLING_PORT:-8099}` is 8090, and billing's
`CATALOG_URL: http://${CATALOG_HOST}:3000` is `http://catalog:3000`.
`SESSION_SECRET` and `GREETING` lend nothing: a secret's name, and a value
that is no port, address or host name.

| Request | Joins |
|---|---|
| `GET http://localhost:8090/invoices` | billing `GET /invoices`, published as 8090 (before P331: the mapping, written with a placeholder, was not read, and the request was a third party's) |
| billing's `GET ${CATALOG_URL}/products` | catalog `GET /products`, by `http://catalog:3000` (before P331: the placeholder unsettled, the value not read) |

## A cluster's workloads

`skaffold.yaml` builds `registry.example.test/shop/inventory` from
`inventory/`, whose Dockerfile sets `PORT=5000`; `k8s/inventory.yaml` routes
`inventory:80` to port 5000. `k8s/ledger.yaml` runs
`registry.example.test/shop/ledger:1.0`, which nothing builds, and routes
`ledger:80` to 6000.

| Request | Joins |
|---|---|
| `GET http://inventory/items` | inventory `GET /items`, `listensAt: src/app.ts:9 (PORT from Dockerfile (inventory)), behind inventory:80 (k8s/inventory.yaml)` (before P331: joined by the name, with `published-port-unheard`, the fallback 3000 read) |
| `GET http://ledger/entries` | ledger `GET /entries`, by the name, with the `container-image-unread` row beside `published-port-unheard` |

## Expected

```
calls out: 11 total, 9 linked, 2 no route (a third party each, with a target-route-not-found row)
rows: container-image-unread (orders, ledger), published-port-unheard (orders, ledger), base-url-from-files (billing)
```
