# env-order-framework-ports

Servers whose port P315 left unread - started by a framework's own command,
moved by several loaded environment files, offered by an example file, held
by a callback's, a class's or a function's write, or loaded by a path built
from the file's own directory - and a jobs service calling them on this
machine (P321). Nothing is installed, as in a fresh clone.

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| catalog | defaults `require(path.join(__dirname, 'defaults'))`; `setConfig(given)` merges inside `ready.then(() => { ... })`; `let config = getConfig(); config = await applyPlugins(config);` | `{ port: 4100, handed: 'src/main.ts:3', merged: 'src/config/holder.ts:10' }`: the defaults file is read, the callback's write is the setter's, the plugins hand the value back |
| search | `class Settings { private values = defaults; load(given) { this.values = { ...this.values, ...given }; } }`, `settings.load({ port: 4200 })` before `settings.get().port` | `{ port: 4200, handed: 'src/main.ts:5', merged: 'src/settings.ts:8' }` |
| orders | `node --env-file=.env --env-file=.env.local`, `PORT` in both | 4300 from `.env.local`: the later `--env-file` wins |
| billing | `NODE_ENV=production bun src/main.ts`, `.env`, `.env.development`, `.env.production` | 4400 from `.env.production` |
| inventory | `process.env.INVENTORY_PORT ?? 3000`, nothing loaded, `INVENTORY_PORT=4500` in `.env.example` | 3000 `[INVENTORY_PORT]`; the linker offers 4500 from the example as a guess |
| gateway | `fastify start -l info dist/app.js`, `FASTIFY_PORT=4600` in `.env` | 4600 from `.env` |
| cms (Strapi) | `config/server.js` `port: env.int('PORT', 1337)`, `PORT=4700` in `.env` | 4700 from `.env` (no route is read) |
| site (Gatsby) | `gatsby develop`, `PORT=8102` in `.env.development`; `gatsby serve -p 9100` | 8000 as a default, with an info `listen-port-guessed` row naming the file; 9100 |
| worker | `let port = 3800; port = await getPort({ port });` | `{ port: 3800, rewritten: 'src/main.ts:6' }` and an info `listen-port-guessed` row |

## jobs

Every call is joined to its service's route, each a guess:
`localhost:4100/api/items` (catalog), `4200/api/search` (search),
`4300/api/orders` (orders), `4400/api/invoices` (billing), `4500/api/stock`
(inventory, at the example's port), `4600/api/health` (gateway) and
`3800/api/tasks` (worker).
