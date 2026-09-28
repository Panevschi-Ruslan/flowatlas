# express-not-installed

An Express service whose framework is declared and **not installed**, which is
what a stranger's clone is. There is no `node_modules` beside this fixture, so
`express` resolves to nothing, every application is `any` to the checker, and a
reader that knows an application by its type reads no route at all. That was
A video platform's fresh clone - 0 addresses of 343 - and the reason a commerce monorepo's
`commands/start.ts` and admin `serve.ts` were excused from the read gate (R142).

What the source still says is the point. An import names the package and the
export, and a call of that export says what the value is:

```ts
import express from 'express';
const app = express().disable('x-powered-by');
```

| Site | Read as | What the source states |
|---|---|---|
| `app.get('/health', …)` | `GET /health` | the default export of `express` makes an application; `disable` hands it back |
| `videosRouter.get('/videos', …)` under `app.use('/api/v1', …)` | `GET /api/v1/videos` | `express.Router()`, a member of the default import |
| `videosRouter.get('/videos/:id', …)` | `GET /api/v1/videos/:param` | the same |
| `router.get('/', …)` in `serve()`, mounted by `app.use('/admin', serve())` | `GET /admin` | `Router()` from `express`, returned by a function of the repository |
| `router.get('/*', …)` | `GET /admin/*` | the same |
| `app.get('trust proxy')` | nothing | one argument: a setting read |
| `cache.get(key, { allowStale: true })` | nothing | `LRUCache` is from `lru-cache`, which states nothing about an application |

Which exports make an application is written once, on each dialect in
`route-dialects.ts` (`makers`, and `chainable` for `disable`), and read by
`stated-apps.ts` for all four call-registered frameworks. It is asked only where
the checker resolved no type at all, so the same repository with `express`
installed reads exactly as before.

Every entry here carries `confidence: heuristic` in its meta, and none would
with types installed: the source states what the author meant rather than what
a compiler checked - the rule R122 set for the data layer (`db-not-installed`).
