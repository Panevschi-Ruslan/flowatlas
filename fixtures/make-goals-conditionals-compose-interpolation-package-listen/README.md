# make-goals-conditionals-compose-interpolation-package-listen

What P343, P348 and P350 left open about a server's environment and where it
listens, read by P356: a Makefile's `$(MAKECMDGOALS)`, its conditionals and
its pattern-specific variables; a compose value interpolated from the
project's `.env` or its default, and a service's `env_file`, for Bun's mode;
Bun run under the name `node`; and a program that listens through a package
of the workspace.

## A Makefile's goal, conditionals and patterns

The root `Makefile` exports `PORT = 4310` when `$(MAKECMDGOALS)` is
`orders-dev`, `4319` for any other `*-dev` goal (`$(filter %-dev,...)`), and
`4300` otherwise; `%-staging: export PORT = 4330` gives every `*-staging`
goal its own. `orders orders-dev:` run `cd orders && npm start`, and
`orders-staging` builds `orders`.

| Request | Joins |
|---|---|
| `GET http://localhost:4300/orders` | orders `GET /orders`: `make orders`, the `else` branch (before P356: the conditional was not read, and its last assignment, 4300, was every goal's) |
| `GET http://localhost:4310/orders` | orders: `make orders-dev`, `$(MAKECMDGOALS)` read as the goal asked |
| `GET http://localhost:4330/orders` | orders: `make orders-staging` builds `orders` with the pattern's `PORT` in effect (before P356: pattern-specific variables were not read) |

`billing`'s recipe is written under `ifdef CI`, a variable only the
environment make runs in gives: both branches are read, `PORT=4350` and
`PORT=4351`, and each port is said in a `make-conditional-unsettled` row.

## Bun's mode from compose

Each Bun server is `Bun.serve({ fetch: app.fetch })` with no port, and
listens on the `PORT` the files Bun loads for its mode give (4x01 in
`.env.development`, 4x02 in `.env.production`). `docker-compose.yml` builds
them:

| Service | Compose writes | Listens on |
|---|---|---|
| `catalog` | `NODE_ENV: ${CATALOG_MODE:-development}`, the project's `.env` setting `CATALOG_MODE=production` | 4402 (before P356: a value compose interpolates was not read, so 4401) |
| `search` | `NODE_ENV=${SEARCH_MODE}`, which nothing but the shell running compose gives | 4501, the mode Bun takes with none, and a `run-mode-unsettled` row |
| `pricing` | `env_file: ./pricing/compose.env`, which sets `NODE_ENV=production` | 4602 (before P356: 4601) |

## Bun run as node

| Service | Started by | Listens on |
|---|---|---|
| `tickets` | `dev`: `bun --bun run serve`; `serve`: `NODE_ENV=production node src/index.js` - Bun's `--bun` puts Bun in `node`'s place | 4702 (before P356: 4701, the files of a bare `bun <file>`) |
| `alerts` | its `Dockerfile` links Bun to `/usr/local/bin/node`, `ENV NODE_ENV=production`, `CMD ["node", "src/index.js"]` | 4802 (before P356: 4801) |
| `notices` | its `Dockerfile` is built `FROM oven/bun:1` and runs `node src/index.js`: whether that image's `node` is Bun is not read | 4901, read as Node, and a `run-mode-unsettled` row |

## A program listening through a package

`scripts/up.sh` exports `PORT=4950` and runs `node bin/serve.js`, which only
does `require('@shop/inventory')`. `inventory`'s manifest names
`dist/index.js`, which no build has written; its source is `src/index.ts`,
which listens on `PORT`.

| Request | Joins |
|---|---|
| `GET http://localhost:4950/stock` | inventory `GET /stock`, `PORT from scripts/up.sh` (before P356: a listen was followed through relative imports only, so no service was given the port) |

`jobs` makes every request above; each joins its route.
