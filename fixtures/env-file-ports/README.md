# env-file-ports

Three full-stack applications whose frameworks assume port 3000, and a jobs
service calling them on this machine (P305). Nothing is installed, as in a
fresh clone.

## Where each application listens

| Service | Started by | `meta.listen` |
|---|---|---|
| shop (Next) | `next dev`, `next start` | `{ port: 3000, setting: 'PORT', default: true }`: Next decides its port before it loads `.env`, so the `PORT=3030` there moves nothing |
| dashboard (Nuxt) | `nuxi dev` | `{ port: 3010, file: '.env', setting: 'NUXT_PORT', valueFrom: '.env' }`: `nuxi dev` loads `.env` before it listens, and takes `NUXT_PORT`, `NITRO_PORT` or `PORT` |
| board (Remix) | `remix dev`, `remix-serve build` | `{ port: 8002, file: '.env.example', setting: 'PORT', default: true, valueFrom: '.env.example' }`: `remix dev` loads `.env`, and no `.env` is committed, so its example's `PORT` is a candidate, as weak as the default it replaces |

## jobs

| Call | Joined to |
|---|---|
| `shop.orders.list.query()`, a tRPC link to `http://localhost:3000/api/trpc` | the shop's `orders.list`: only a default places anyone at 3000, and the shop declares the procedure, so the port places the link there, as a guess |
| `shop.reports.weekly.query()`, the same link | nobody declares it, so the port places nothing and the link is the external `localhost:3000`, as before |
| `fetch('http://localhost:3010/api/stats')` | the dashboard's `GET /api/stats`, at the port its `.env` gives |
| `fetch('http://localhost:8002/api/health')` | the board's `GET /api/health`, at its example's port |
| `fetch('http://localhost:3000/api/health')` | the external `localhost:3000`: the board no longer assumes 3000, and the shop serves no `/api/health` |
