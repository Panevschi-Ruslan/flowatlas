# workspace-env-greedy-sides fixture

Three shapes read since P283:

1. **A workspace's own files, for its packages.** `shop/` is an npm workspace
   whose one `.env.example` at the top gives `VITE_API_URL=http://localhost:4100/v1`
   and whose `docker-compose.yml` publishes `api` on 4100. The configuration is
   kept outside the workspace, so neither file is beside it nor in a package.
   `web` reads `${import.meta.env.VITE_API_URL}/tokens/list`; the value's
   `/v1` is put in front, and the request joins `api`'s `GET /v1/tokens/list`
   (`base-url-value`, a `base-url-from-files` row naming `../../.env.example`).
   A package's own file is nearer and wins for a setting both give; a port the
   workspace's file writes is no package's own.
2. **API Gateway's greedy `{proxy+}`.** `files/serverless.yml` serves
   `GET files/{proxy+}`, keyed `/files/*` as every catch-all is, so
   `/files/reports/2026/summary` reaches it (with a `route-wildcard-only`
   note); `/files/session/current` reaches the one-segment
   `GET /files/session/:param` before the catch-all.
3. **One request, one side.** `store` is a Remix application, read by both
   halves. `readReport` is called only by a route's `loader`: drawn once,
   `http_out`. `preview` is called only by a click on the screen: drawn once,
   `ui_api_call`. `readShared` is called by the route's `action` and by a click:
   both stay, each naming the other under `meta.sameCall`. `whoAmI` is in a
   `.server.ts` module: `http_out` whoever imports it.

| Where | Request | Drawn as | Joins |
|---|---|---|---|
| `web` `Tokens.tsx:7` | `GET ${VITE_API_URL}/tokens/list` | `ui_api_call` | api `GET /v1/tokens/list` |
| `web` `Tokens.tsx:8` | `DELETE ${VITE_API_URL}/tokens/revoke` | `ui_api_call` | api `DELETE /v1/tokens/revoke` |
| `web` `Tokens.tsx:9` | `GET ${VITE_API_URL}/docs/${slug}` | `ui_api_call` | api `GET /v1/docs/:param` |
| `store` `files.ts:3` | `GET ${FILES_URL}/files/reports/${year}/summary` | `http_out` | files `GET /files/*` |
| `store` `files.ts:9` | `GET ${FILES_URL}/files/shared/${name}` | both, paired | files `GET /files/*` |
| `store` `files.ts:14` | `GET ${FILES_URL}/files/previews/${name}` | `ui_api_call` | files `GET /files/*` |
| `store` `session.server.ts:2` | `GET ${FILES_URL}/files/session/current` | `http_out` | files `GET /files/session/:param` |
