# compose-include-shell-env fixture

What P331 left open, read by P337: compose's `COMPOSE_ENV_FILES`, a
service that `extends:` one in another file, a compose file `include:`d by
another, a script's exported variables, and a cluster workload's config map,
secret and chart image.

## Compose

The root `.env` names `COMPOSE_ENV_FILES=compose.ports.env`, so compose
interpolates `docker-compose.yml` from that file in place of the `.env`
(`ORDERS_PORT=8101`, `BILLING_PORT=8070`). `scripts/up.sh` exports
`BILLING_PORT=8102` before it runs `docker compose up`, and compose prefers
the shell's value over every file. `orders` extends `node` from
`compose/common.yml`, whose `env_file: node.env` is that file's own,
`compose/node.env` (`PORT=3000`). `docker-compose.yml` includes
`deploy/catalog.compose.yaml`, interpolated from `deploy/.env`
(`CATALOG_PORT=8103`), its `build: ../catalog` resolved from `deploy/`.

| Request | Joins |
|---|---|
| `GET http://localhost:8101/orders` | orders `GET /orders`, `listensAt: src/app.ts:9 (PORT from compose/node.env (orders)), published as 8101 by docker-compose.yml` (before P337: `.env` gave no port and `extends:` was not read; the mapping fell back to 8099 and the container had no PORT) |
| `GET http://localhost:8102/invoices` | billing `GET /invoices`, published as 8102: the script's export over `compose.ports.env` (before P337: the default, 8098) |
| `GET http://localhost:8103/products` | catalog `GET /products`, `listensAt: src/app.ts:9 (PORT from deploy/catalog.compose.yaml (catalog)), published as 8103 by deploy/catalog.compose.yaml` (before P337: the included file was not read) |

## A server a script starts

`run-stock.sh` runs `cd stock`, `export PORT=4600`, `npm start`; stock
listens on `process.env.PORT ?? 3000`.

| Request | Joins |
|---|---|
| `GET http://localhost:4600/levels` | stock `GET /levels`, `listensAt: src/app.ts:9 (PORT from run-stock.sh)`, firm as a loaded file's port is (before P337: nothing at 4600, a third party) |

## The cluster

`k8s/ledger.yaml` runs `registry.example.test/shop/ledger:1.0`, which the
root `Makefile` builds from `ledger/Dockerfile` (`ENV PORT=6500`), with
`envFrom` a config map (`PORT: "7000"`) and a secret (`ADMIN_PORT`, read by
name only, its value never). The `audit` chart's image is
`{{ .Values.image.repository }}:{{ .Values.image.tag }}`, which its values do
not give.

| Request | Joins |
|---|---|
| `GET http://ledger/entries` | ledger `GET /entries`, `listensAt: src/app.ts:9 (PORT from k8s/ledger-config.yaml (ledger)), behind ledger:80 (k8s/ledger.yaml)`: the config map over the image's 6500 |
| `GET http://audit/log` | audit `GET /log` by the name, with an info `container-image-unread` row: the image's name is a template value the values do not settle (before P337: no row) |

## Expected

```
calls out: 6 total, 6 linked
rows: container-image-unread (audit)
```
