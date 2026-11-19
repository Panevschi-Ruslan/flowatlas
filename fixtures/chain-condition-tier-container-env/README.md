# chain-condition-tier-container-env fixture

Two things P319 left open, read by P325.

## A condition later in a chain

`process.env.PRIMARY_URL || (isProd ? process.env.EAST_URL :
process.env.WEST_URL) || process.env.ARCHIVE_URL`: the condition's two
branches are one tier after `PRIMARY_URL`, written
`baseUrlAlsoTiers: [["EAST_URL", "WEST_URL"]]`, and `ARCHIVE_URL` a tier
after them. Both branches' claimants are asked alike.

| Request | Joins |
|---|---|
| `GET ${mirrorBase()}/regions` | nothing: east and west both serve it, an `ambiguous-route-target` row, "read from the first of them that is set, a condition nobody settles choosing among the later ones" (before P325: east, `heuristic`, for being written first) |
| `GET ${mirrorBase()}/west-only` | west `GET /west-only`, `heuristic`, `chosenAmong` naming all four claims |
| `GET ${mirrorBase()}/exports` | archive `GET /exports`, `heuristic`, the tier after the condition |
| `GET ${mirrorBase()}/primary-only` | primary `GET /primary-only`, `static`, the first setting's join as it always was |

## A fallback port inside a container

`inventory` listens on `process.env.PORT ?? 3000` and its compose container
publishes `8080:4000`; the container is started with `inventory/.env`, which
sets `PORT=4000`. The file is one whose values are otherwise kept unread, but
the container is started with it, so the port of a setting that is no
secret's is read into the container's environment.

`billing` listens on `process.env.BILLING_PORT ?? 3000` and its container
publishes `8081:4100`. Its image is built from `billing/Dockerfile` at the
stage `runtime`, which sets `BILLING_PORT` from the `ARG LISTEN_PORT=4100`
over the `3900` of the stage it is built from; the `debug` stage after it is
not the one built.

| Request | Joins |
|---|---|
| `GET http://localhost:8080/items` | inventory `GET /items`, `heuristic`, `listensAt: src/app.ts:10 (PORT from inventory/.env (inventory)), published as 8080 by docker-compose.yml` (before P325: a `published-port-unheard` note at the mapping, the code heard at 3000 inside the container) |
| `GET http://inventory:4000/items` | inventory `GET /items`, `static`, in the container on the compose network, `listensAt` naming `inventory/.env` |
| `GET http://localhost:8081/invoices` | billing `GET /invoices`, `heuristic`, `listensAt: src/app.ts:10 (BILLING_PORT from billing/Dockerfile (billing)), published as 8081 by docker-compose.yml` (before P325: a `published-port-unheard` note) |

## Expected

```
calls out: 7 total, 6 linked, 1 ambiguous
```
