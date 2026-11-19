# container-script-environment fixture

What P337 left open, read by P343: a compose setting written with no value,
an included compose file's precedence, a Makefile's own exports, a script's
export reaching a program of the project's own, and a port a Secret gives.

## Compose

`docker-compose.yml` gives `orders` `environment: [PORT]` with no value:
compose takes it from the project's `.env` (`PORT=3300`), and `8201:3300`
reaches it. `billing` writes `BILLING_PORT:` and nothing gives it a value,
so it stays unset, as compose leaves it. The file includes
`deploy/catalog.compose.yaml`, whose own `deploy/.env` sets
`CATALOG_PORT=8103` and `CATALOG_INNER_PORT=4000`; the project's `.env`
sets `CATALOG_PORT=8203`, and the including project's environment wins (the
Compose Specification's `include`, compose-go's `Merge`), the included
`.env` only filling `CATALOG_INNER_PORT`.

| Request | Joins |
|---|---|
| `GET http://localhost:8201/orders` | orders `GET /orders`, `listensAt: src/app.ts:9 (PORT from docker-compose.yml (orders)), published as 8201` (before P343: the value-less `PORT` was dropped, and 3300 was heard by nothing) |
| `GET http://localhost:8202/invoices` | billing `GET /invoices` by the published port, with the info row `published-port-unheard`: `BILLING_PORT`, which the container's environment does not give |
| `GET http://localhost:8203/products` | catalog `GET /products`, published as 8203: the project's `.env` over the included file's own (P337's precedence; the included file's `.env` still gives the inner port) |

## A Makefile's exports

The root `Makefile` writes `export PORT := 4700`, the environment of every
recipe, and `ledger: export PORT = 4710` for that target only.

| Request | Joins |
|---|---|
| `GET http://localhost:4700/levels` | stock `GET /levels`, `listensAt: src/app.ts:9 (PORT from Makefile)`: `cd stock && npm start` (before P343: a make variable was not the recipe's environment) |
| `GET http://localhost:4710/entries` | ledger `GET /entries`, `listensAt: src/app.ts:9 (PORT from Makefile)`: the target's own export over the file's |

## Programs of the project's own

`scripts/run-api.sh` exports `PORT=4800` and runs `shop-api`, a `bin` of
`api/package.json` whose file requires `../src/app`, which listens.
`scripts/run-jobs.sh` exports `PORT=4810` and runs `./bin/jobs`, a shell
script that runs `tsx jobs/src/app.ts`. `scripts/run-admin.sh` runs
`shop-admin`, whose `bin` points at `dist/cli.js`, which a build writes.

| Request | Joins |
|---|---|
| `GET http://localhost:4800/carts` | api `GET /carts`, `listensAt: src/app.ts:9 (PORT from scripts/run-api.sh)` (before P343: a program the start list does not know was not followed) |
| `GET http://localhost:4810/runs` | jobs `GET /runs`, `listensAt: src/app.ts:9 (PORT from scripts/run-jobs.sh)` |

`shop-admin` is the info row `server-start-unread`: started with
`PORT=4820`, but `admin/dist/cli.js` is not in the repository.

## A Secret

`k8s/accounts.yaml` gives its pods `PORT` from the Secret `accounts-ports`,
key `http`. The Secret's values are never read: `published-port-unheard`
names the Secret, the key and `k8s/accounts-ports.yaml`, and neither the
base64 value nor the token beside it is anywhere in the output.

| Request | Joins |
|---|---|
| `GET http://accounts/balances` | accounts `GET /balances` by the name, with the row naming where its port is from |

## Expected

```
calls out: 8 total, 8 linked
rows: published-port-unheard (accounts, billing), server-start-unread (admin)
```
