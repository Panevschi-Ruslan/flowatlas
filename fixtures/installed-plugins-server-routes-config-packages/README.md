# installed-plugins-server-routes-config-packages

The framework, write and instance items P329 left open (P335): routes a
Strapi application registers on its server in code, an installed plugin's
routers read from its package, extensions that add a route to a local
plugin's router and answer an installed plugin's action, a plugin no key of
`config/plugins` enables; a Gatsby plugin listed by its path and one
installed under `node_modules`; a `fastify start --config` naming a package,
and one naming a TypeScript file exporting its port by name; a key written
through two levels of parameters, cut at the call that makes it; and a field
read per instance a receiver is handed through three levels of parameters. A
poller calls each on this machine. The only packages installed are the two
plugins and the configuration package under the services' `node_modules`.

## Ways in

| Service | Declared | Entries |
|---|---|---|
| cms (`type: "strapi"`) | `src/index.ts`'s `register` calls `strapi.server.routes({ type: 'content-api', routes })`, its `bootstrap` `strapi.server.router.get('/ping', fn)` | `GET /api/health` on `api::order.order.health`, `GET /ping` on the function written there |
| cms | `strapi-plugin-ratings` is a dependency whose package says `strapi.kind: 'plugin'`, named `ratings`; `config/plugins.ts` writes its `config` and no `enabled`, which the dependency fills in; its server is read from the source its `exports` ships (`server/index.js`) ahead of the `require` build, not held here; its `content-api` router is `createContentApiRoutesFactory` over a spread list | `GET /api/ratings/ratings` (`handlerVia: 'package'`), `POST /api/ratings/ratings` on the action `src/extensions/ratings/strapi-server.ts` writes, `GET /ratings/settings` (admin API), each drawn at `package.json` with `meta.package` |
| cms | `reviews` enabled with `resolve`; `src/extensions/reviews/strapi-server.ts` pushes `GET /top` into its `content-api` router and writes `review.top` | `GET /api/reviews/latest` on the plugin's controller, `GET /api/reviews/top` on the extension's function |
| cms | `drafts` resolved by `config/plugins.ts` without `enabled: true` | none: an info `plugin-not-enabled` row, as Strapi does not load it |
| site (`type: "gatsby"`) | `gatsby-config.js` lists `require.resolve('./vendor/contact')` and `gatsby-plugin-forms`, installed with `src/api/gatsby-plugin-forms/submit.js` | `ALL /api/contact/send` (narrowed to `POST`) and `ALL /api/gatsby-plugin-forms/submit` (`handlerVia: 'package'`) |

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| cms | `config/server.ts` `port: 4510` | 4510 |
| site | `gatsby develop -p 8300` | 8300 |
| gateway | `PORT=4999 fastify start -c @shop/gateway-config`; the package's `exports` gives `index.cjs` for `require`, which writes `exports.port = 4520` | 4520 |
| edge | `fastify start --config fastify.config.ts`; `export { logLevel, port }` of `const port: number = 4530` | 4530 |
| api | `settings = { port: 3540 }`; `prepare(settings)` before the read calls `await applyDeployment(config)`, which writes `target.port = 4540` | 4540, handed at `applyDeployment(config)` in `prepare` (`src/main.ts:11`); the write is cut at the `prepare(settings)` call before the read, so 3540 is no longer a value |
| workers | `main(new Server(4550))` hands it to `launch`, then `boot`, which calls `server.start()`; `spare = new Server(4551)` is never started | 4550 handed at `main(...)` |

## poller

Every call is joined: `localhost:4510/api/health`, `/ping`,
`/api/ratings/ratings` (both verbs) and `/api/reviews/latest` and `/top` to
the cms; `localhost:8300/api/contact/send` and
`/api/gatsby-plugin-forms/submit` to the site's plugins; `4520/api/status`
(gateway), `4530/api/edge` (edge), `4540/health` (api) and `4550/api/work`
(workers).
