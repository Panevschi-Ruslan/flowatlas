# script-modes-workspace-make-fields

What P343, P346 and P348 left open, read by P350: a Makefile's included file
and the targets that build another, a script run in another package of the
workspace, Bun's mode however it is given, a server several scripts start in
different modes, and an application held by a field or by a parameter's
default.

## A Makefile and the file it includes

The root `Makefile` exports `PORT := 4300`, includes `mk/*.mk`, and gives
`dev` its own `PORT = 4310` with `stock` as its prerequisite. `mk/stock.mk`
writes the `stock` recipe, `cd stock && npm start`.

| Request | Joins |
|---|---|
| `GET http://localhost:4300/levels` | stock `GET /levels`, `listensAt: src/app.ts:10 (PORT from mk/stock.mk)`: the included file's recipe read with the including Makefile's exports (before P350: `mk/stock.mk` was read as a Makefile of its own, with no variables) |
| `GET http://localhost:4310/levels` | stock `GET /levels`: `make dev` builds `stock` with `dev`'s variables in effect, as make hands a target's variables to its prerequisites |

## A script run in another package

`scripts/up.sh` exports `PORT=4400` and runs `pnpm --filter @shop/ledger dev`,
then `PORT=4410` and `npm run serve -w @shop/audit`. Each is followed to that
package's script: `tsx watch src/app.ts` in `ledger`, `node src/app.js` in
`audit`.

| Request | Joins |
|---|---|
| `GET http://localhost:4400/entries` | ledger `GET /entries`, `PORT from scripts/up.sh` (before P350: `--filter` and `-w` were not read, and nothing was given the port) |
| `GET http://localhost:4410/events` | audit `GET /events`, `PORT from scripts/up.sh` |

## Bun's mode, and a server several scripts start

Each Bun server is `Bun.serve({ fetch: app.fetch })` with no port: Bun listens
on the `PORT` the files it loads for its mode give.

| Service | Started by | Listens on |
|---|---|---|
| `shop` | `dev`: `bun --watch src/index.ts`; `start`: `export NODE_ENV=production && bun src/index.ts` | 4101 (`.env.development`) and 4102 (`.env.production`), one reading per script (before P350: the files were merged, the first script's first, and only 4101 was heard; and an exported mode was not read) |
| `admin` | `serve`: `bun src/index.ts`; `start`: `cross-env NODE_ENV=production bun run serve`; `local`: `NODE_ENV=production; bun src/index.ts`; its `Dockerfile`: `ENV NODE_ENV=test`, `CMD ["bun", "run", "serve"]` | 4201 (`.env.development`), 4202 (`.env.production`) and 4203 (`.env.test`). `local` sets `NODE_ENV` with no `export`: the shell keeps it and Bun never sees it, so `local` runs in development, as `serve` does |
| `reports` | no script; `docker-compose.yml` builds it with `BUN_ENV: production`, its Dockerfile running `bun src/index.ts` | 4502 (`.env.production`) (before P350: 4501, the development files of a bare `bun <file>`) |
| `metrics` | `start`: `bun src/index.ts`; `bunfig.toml` writes `env = false` | 3000, Bun's default: none of Bun's own files is loaded, so `.env`'s 4600 is not where it listens |

`jobs` calls 4101, 4102, 4201, 4202, 4203 and 4502; each joins its route.

## A field and a parameter's default

`catalog` declares Express and does not install it.

| Route | Confidence | Why |
|---|---|---|
| `GET /api/products` | typed | `private products = Router()`, mounted on `private readonly app = express()`: fields nothing but their own constructor writes (before P350: `heuristic`) |
| `GET /api/drafts` | `heuristic` | `drafts` is written again in `reset()` |
| `GET /reviews` | typed | `mountReviews(router = Router())`, and its one caller hands it nothing |
| `GET /tags` | `heuristic` | `mountTags(Router())` hands the parameter a value of its own |

`jobs`'s request to `/api/products` joins `static`; the one to `/api/drafts`
stays `heuristic`.
