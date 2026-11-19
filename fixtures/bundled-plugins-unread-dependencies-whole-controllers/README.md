# bundled-plugins-unread-dependencies-whole-controllers

What P335 left open (P345): an installed Strapi plugin whose package ships
only a bundled build - a rollup build with lazy `requireX()` wrappers in a
chunk, and an esbuild build with `__commonJS` module factories - read
through the bundler's wrappers; dependencies not installed (a fresh clone)
that the repository says are Strapi plugins, by their names or by a lockfile
entry; an extension writing a plugin's controller whole, with and without
the plugin's own spread into it; and a key written through a chain of three
functions whose value is an outer parameter, bound to the call the write is
cut at. A poller calls each on this machine.

## Ways in

| Service | Declared | Entries |
|---|---|---|
| cms (`type: "strapi"`) | `strapi-plugin-tags`, installed, its `exports['./strapi-server']` naming only `build/server/index.js`, which hands `getDefaultExportFromCjs(requireServer())` of a chunk; `requireServer` returns a function whose routes are `requireRoutes()`, an object of `requireAdmin()` (assigned whole) and `requireContentApi()` (keys written into `{}`) | `GET /tags/settings` (admin API), `GET /api/tags/tags` (`handlerVia: 'package'`), `POST /api/tags/tags` on the action `src/extensions/tags/strapi-server.ts` writes in the controller it writes whole, spreading the plugin's own |
| cms | `@shop/strapi-plugin-reports`, installed, its `strapi-server.js` an esbuild bundle: `module.exports = require_server()`, the routes module writing `exports2['content-api']` | `GET /api/reports/reports`, `GET /api/reports/reports/:id/export` (`handlerVia: 'package'`) |
| cms | `reviews` enabled with `resolve`; `src/extensions/reviews/strapi-server.ts` writes `review` whole over `...original(opts)` with `list`, and `flag` whole as `{ mark }` | `GET /api/reviews/list` and `POST /api/reviews/flag` on the extension's actions, `DELETE /api/reviews/:id` on the plugin's own `remove`, `DELETE /api/reviews/flag` unread (a `route-handler-unread` row: the extension's `flag` neither writes `clear` nor spreads the plugin's) |
| cms | `@strapi/plugin-users-permissions` (configured, not installed) and `tagger-kit` (not installed, its `package-lock.json` entry a peer of `@strapi/strapi`); `strapi-plugin-notes` turned off by `config/plugins.ts` | none: one `route-registry-unread` row each for `users-permissions` and `tagger-kit`, at `package.json`; none for `notes` |
| api (`type: "express"`) | `GET /health` | `GET /health` |

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| cms | `config/server.ts` `port: 4510` | 4510 |
| api | `settings` starts without a port; `deploy(settings, 4610)` calls `configure(config, port)`, which calls `applyPort(config, port)`, which writes `target.port = port`; `preview()` calls `configure` and `deploy` with 4699 and 4698 on settings of its own | 4610 only: the write is cut at `deploy(settings, 4610)`, and `port` is bound through `configure` and `deploy` to that call |

## poller

Every call is joined: `localhost:4510/api/tags/tags` (both verbs),
`/api/reports/reports`, `/api/reviews/list`, `/api/reviews/:id` and
`/api/reviews/flag` (`POST`) to the cms; `localhost:4610/health` to the api.
