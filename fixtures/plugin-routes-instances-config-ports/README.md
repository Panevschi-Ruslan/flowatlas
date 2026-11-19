# plugin-routes-instances-config-ports

The framework, write and instance items P327 left open (P329): a Strapi
local plugin's routers, a routes file written as a function, a route's
policies and middlewares, the environment a start script sets; a Gatsby
local plugin's functions and the path prefix `gatsby serve --prefix-paths`
adds; a `fastify start --config` file's port; a key a settings literal does
not declare, laid over it through a getter and a parameter; and a field read
for the instance a parameter property holds. A poller calls each on this
machine. Nothing is installed, as in a fresh clone.

## Ways in

| Service | Declared | Entries |
|---|---|---|
| cms (`type: "strapi"`) | `config/plugins.ts` enables `reviews` with `resolve: './src/plugins/reviews'`; its `strapi-server.ts` exports `server/index.ts`, whose `routes` are a `content-api` router and an `admin` router; `src/api/order/routes/order.ts` exports a function returning the routes | `GET /api/reviews/summary` (content API, under `/api` and the plugin's `/reviews`), `PUT /reviews/settings` (admin API, no `/api`), both on the plugin's own `review` controller; `GET /api/orders/mine` on the order controller |
| site (`type: "gatsby"`) | `src/api/hello.ts`; `gatsby-config.ts` lists `newsletter-local`, whose `package.json` names it `newsletter`, with `plugins/newsletter-local/src/api/newsletter/subscribe.ts`; `pathPrefix: '/blog'`, `gatsby serve --prefix-paths` | `ALL /api/hello` and `POST /api/newsletter/subscribe`, and the same two under `/blog` |

What stands in front of the cms's routes: `GET /api/orders/mine` is guarded
by `global::is-signed-in` (`src/policies/is-signed-in.ts`) and wrapped by
`api::order.audit` (`src/api/order/middlewares/audit.ts`); `PUT
/reviews/settings` by the plugin's `can-edit` policy
(`server/policies/can-edit.ts`, a key of the plugin's `policies`). The route
`src/extensions/accounts/strapi-server.ts` pushes into an installed plugin's
router is a `route-mount-unread` row: that router and its prefix are not the
repository's code.

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| cms | `NODE_ENV=staging strapi start`; `config/env/staging/server.ts` 4411, `config/env/production/server.ts` 4410 | 4411; an info `framework-environment-differs` row names production's 4410 |
| site | `gatsby develop -p 8200`, `gatsby serve --prefix-paths -p 9200` | 8200 and 9200, dev servers |
| gateway | `PORT=4999 fastify start -c fastify.json`, `"port": 4420` in `fastify.json` | 4420: fastify-cli lays its command line over the `--config` file and reads `PORT` only after it |
| api | `settings: Settings = { host }` declares no `port`; `apply(current(), { port: 4430 })`, `apply` calling `Object.assign(target, overrides)` and `current()` returning `settings` | 4430 handed at `src/main.ts:8` |
| workers | `new Supervisor(primary).run()`, `run()` calling `this.server.start()` on its parameter property; `primary = new Server(4440)`, `spare = new Server(4441)` never started | 4440 handed at `src/main.ts:12`: the field read for the instance the supervisor holds |

## poller

Every call is joined: `localhost:4411/api/reviews/summary`,
`/reviews/settings` and `/api/orders/mine` to the cms's routes;
`localhost:8200/api/newsletter/subscribe` to the plugin's function and
`localhost:9200/blog/api/hello` to the site's own under the prefix;
`4420/api/status` (gateway), `4430/health` (api) and `4440/api/work`
(workers).
