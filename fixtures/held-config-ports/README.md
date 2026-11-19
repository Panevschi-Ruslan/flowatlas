# held-config-ports

Servers whose port is decided away from the line that starts them, and a jobs
service calling them on this machine (P315). Nothing is installed, as in a
fresh clone.

## Where each server listens

| Service | How the port is given | `meta.listen` |
|---|---|---|
| catalog | `bootstrap({ apiOptions: { port: 4100 } })` calls `setConfig(given)`, which lays it over a module variable (`current = mergeConfig(current, given)`) holding the defaults' 3000, then `app.listen(port)` with `port` from `getConfig().apiOptions` | `{ port: 4100, handed: 'src/main.ts:3', merged: 'src/config/holder.ts:10' }`: the setter's call before the read is laid over the variable's first value |
| search | `start(port = 3200)` called as `start(4200)`; `startAdmin({ port = 3201 } = {})` called as `startAdmin({ port: 4201 })` and `startAdmin()` | 4200 handed at `src/main.ts:3`; 4201 handed at `src/main.ts:4`, and 3201, the pattern's default, for the caller that hands nothing |
| orders | `import 'dotenv/config'` and `app.listen(process.env.PORT ?? 3000)`, with `PORT=4300` in its committed `.env` | `{ port: 4300, setting: 'PORT', valueFrom: '.env' }`: the code loads the file before it listens, so its fallback gives way |
| legacy | the same holder, its defaults loaded by `import(path.join(__dirname, 'settings-defaults'))` | nothing, and an info `listen-port-unread` row at the listen call naming the load |
| site (Astro) | `server: ({ command }) => ({ port: command === 'dev' ? 4400 : 4401 })`, with `astro dev` and `astro preview` scripts | 4400 for the dev server, 4401 for the preview, each `devServer: true` |

## jobs

| Call | Joined to |
|---|---|
| `fetch('http://localhost:4100/api/items')` | the catalog's `GET /api/items` |
| `fetch('http://localhost:4200/api/search')` | search's `GET /api/search` |
| `fetch('http://localhost:4201/api/reindex')`, `fetch('http://localhost:3201/api/reindex')` | search's `GET /api/reindex`, at the port each caller of `startAdmin` gives it |
| `fetch('http://localhost:4300/api/orders')` | orders' `GET /api/orders`, at its `.env`'s port |
| `fetch('http://localhost:3000/api/orders')` | the external `localhost:3000`: neither the catalog's defaults nor orders' fallback is where they listen |
