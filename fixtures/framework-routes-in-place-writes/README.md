# framework-routes-in-place-writes

Ways in a framework declares outside any `app.get` - a Strapi application's
routes files and a Gatsby site's functions - and servers whose port is
changed in place, read per instance, or given by a loader whose order was
checked against its source (P327). A poller calls each on this machine.
Nothing is installed, as in a fresh clone.

## Ways in

| Service | Declared | Entries |
|---|---|---|
| cms (`type: "strapi"`) | `createCoreRouter('api::product.product', { except: ['delete'] })`, the type's `schema.json` a collection of `products`; custom `routes` in `routes/custom.ts`; `createCoreRouter('api::homepage.homepage', { only: ['find'] })`, a single type | `GET` / `POST /api/products`, `GET` / `PUT /api/products/:id`, `GET /api/products/featured`, `POST /api/products/:id/archive`, `GET /api/homepage`. `GET /api/products` and `featured` land on the controller's `find` and `featured`; the other core routes are Strapi's own actions (`handlerVia: "framework"`); `archive` has no action in the controller, a `route-handler-unread` row |
| site (`type: "gatsby"`) | `src/api/subscribe.ts`, `src/api/users/[id].ts` | `POST /api/subscribe` (the handler compares the method), `ALL /api/users/:id` |

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| cms | `config/server.ts` `env.int('PORT', 1337)`, `config/env/production/server.ts` `env.int('PORT', 4310)`, `config/env/staging/server.ts` `4311` | 4310 `[PORT]` from the production override; an info `framework-environment-differs` row names staging's 4311 |
| site | `gatsby develop -p 8100` | 8100, a dev server |
| api | `config = { server: { port: 3330 } }` in another module, `Object.assign(config.server, { port: 4330 })` before `app.listen(config.server.port)` | 4330: the assign is the last write of the read's block |
| jobs | `loadEnvFile('.env.local')` then `loadEnvFile('.env')` (imported from `node:process`), `JOBS_PORT` in both | 4340 from `.env.local`: each call sets only what is unset |
| admin | `class Listener { private port = 3340; constructor(options) { Object.assign(this, options); } start() { app.listen(this.port); } }`; `new Listener({ port: 4341 })` started, `new Listener({ port: 4342 })` never started | 4341 handed at `src/main.ts:3`: read once per call of `start`, on its instance; the constructor's write replaces the field's 3340 |
| gateway | `PORT=4350 fastify start`, `FASTIFY_PORT=4351` in `.env` | 4351 from `.env`: fastify-cli reads `FASTIFY_PORT` before `PORT`, and loads `.env` without overwriting the command's `PORT` |

## poller and the site's page

Every call is joined: `localhost:4310/api/products/featured`,
`/api/homepage` and `/api/products/${id}` to the cms's routes; the site's
page's `localhost:4310/api/products` to the cms and its `/api/subscribe` to
its own function; `localhost:8100/api/users/${id}` to the site's function;
`4330/health` (api), `4340/api/jobs` (jobs), `4341/api/admin` (admin) and
`4351/api/status` (gateway).
