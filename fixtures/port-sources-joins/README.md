# port-sources-joins fixture

Twelve services on one machine, each deciding the port its server listens on
somewhere other than a literal `app.listen(3001)` (P254): a front end's dev
server configuration, a function the port is handed to, a settings object, a
settings library's default, a setting the service's example environment file
fills, a container that publishes the code's port as another one. Each is read
where it is decided, kept on the service's repository node (`meta.listen`), and
a request to that port on this machine - or to the container on its own
network - joins the service with `meta.listensAt` saying how the port was
found.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | 3000, published as 3001 | `src/app.ts:10` `app.listen(3000)`; `docker-compose.yml` `"3001:3000"` |
| `stock` | express | 3002 | `src/server.ts:10` `(port) => app.listen(port)`, handed at `src/main.ts:3` `start(3002)` |
| `catalog` | express | 3003 | `src/app.ts:11` `app.listen(config.port)`, `src/config.ts` `{ port: 3003 }` |
| `billing` | nestjs | 3004 [PORT] | `src/main.ts:9` `config.get('app.port')`, `registerAs('app', () => ({ port: Number(process.env.PORT) \|\| 3004 }))` |
| `ledger` | koa | 3005 [LEDGER_PORT] | `src/server.ts:16` `config.get('port')`, a convict schema `{ default: 3005, env: 'LEDGER_PORT' }` |
| `audit` | express | 3006 | `src/server.ts:10` `app.listen(process.env.AUDIT_PORT)`, `.env.example` `AUDIT_PORT=3006` |
| `search` | express | 4000 in its container, published as 4007 | `src/server.ts:10` `Number(process.env.PORT) \|\| 3000`; compose `environment: PORT: 4000`, `"4007:4000"` |
| `notify` | express | 3000 | `src/server.ts:10`; compose publishes `"3008:8080"`, a port the code does not listen on |
| `jobs` | express | 3000 in its container, published as 3009 | `src/server.ts:13` `app.listen(process.env.PORT)`; `package.json` `docker run -p 3009:3000 --name jobs-runner -e PORT=3000 jobs` |
| `shop` | sveltekit | 5174 (dev server) | `vite.config.ts:7` `server: { port: 5174 }` |
| `web` | react | 5173 (Vite's default, `strictPort`), 4180 (preview) | `vite.config.ts:7` `strictPort: true`; `package.json` `vite preview --port 4180` |
| `admin` | angular | 4300 (dev server) | `angular.json:16` `serve.options.port` |

## Requests

| Where | Request | Joins | Before P254 |
|---|---|---|---|
| `web` `Dashboard.tsx:3` | `localhost:3001/orders` | orders, `heuristic`, `listensAt: src/app.ts:10, published as 3001 by docker-compose.yml` | orders by the published port alone, no `listensAt` |
| `web` `Dashboard.tsx:4` | `localhost:3002/stock/ABC-1` | stock, `static`, `src/server.ts:10 (handed at src/main.ts:3)` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:5` | `localhost:3003/products` | catalog, `static`, `src/app.ts:11` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:6` | `localhost:3004/invoices` | billing, `heuristic`, `src/main.ts:9 (PORT)` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:7` | `localhost:3005/entries` | ledger, `heuristic`, `src/server.ts:16 (LEDGER_PORT)` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:8` | `localhost:3006/events` | audit, `heuristic`, `src/server.ts:10 (AUDIT_PORT from .env.example)` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:9` | `localhost:4007/search` | search, `heuristic`, `… (PORT from docker-compose.yml (search)), published as 4007 by docker-compose.yml` | search by the published port alone |
| `web` `Dashboard.tsx:10` | `localhost:3008/notices` | notify by the compose file, `heuristic`; the row `published-port-unheard` at `docker-compose.yml:15` | the same, no row |
| `web` `Dashboard.tsx:11` | `localhost:5174/api/basket` | shop, `static`, `vite.config.ts:7` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:12` | `POST localhost:3009/jobs/run` | jobs, `heuristic`, `… (PORT from package.json (jobs-runner)), published as 3009 by package.json` | `unique-route`, and a third party |
| `web` `Dashboard.tsx:13` | `localhost:5173/products`, web's own dev server | catalog by its route alone: a dev server forwards what it does not serve | the same |
| `jobs` `server.ts:7` | `http://orders:3000/orders` | orders, `static`, `src/app.ts:10, in the container orders (docker-compose.yml)` | orders, no `listensAt` |
| `jobs` `server.ts:8` | `http://search:4000/search` | search, `static`, `… (PORT from docker-compose.yml (search)), in the container search (docker-compose.yml)` | search, no `listensAt` |
| `jobs` `server.ts:9` | `localhost:5174/api/basket` | shop, `static` | a third party |

## Expected

```
calls out: 3 total, 3 linked, 0 third party
ui calls: 11 total, 11 joined to a route
notes: 1 (published-port-unheard)
```

Measured with the tool at the commit before P254 over the same tree:

```
calls out: 3 total, 2 linked, 1 third party
ui calls: 11 total, 11 joined to a route, seven of them by route alone and drawn to a third party as well
```
