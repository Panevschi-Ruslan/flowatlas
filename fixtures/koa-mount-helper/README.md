# koa-mount-helper fixture

One Koa application mounted inside another by a helper, which is how outline
mounts five of them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/koa-mount-helper/tsconfig.json --noEmit
```

`node_modules` holds hand-written stubs for `koa`, `@koa/router` and `koa-mount`.

## The shape

```ts
app.use(mount('/api', api));   // a mount nothing here can see through
app.use(healthRouter.routes()); // an install this has always read
```

`koa-mount` hands back middleware. The argument `use` receives is therefore not
an application, and the one thing that separates a mount from a middleware
install on this framework's row is whether what is handed over is an application.
So the line read as an install, the prefix was dropped, and every route on `api`
kept the address it is written at.

## What was wrong (R84)

`POST /documents.info` was recorded for what the service serves at
`POST /api/documents.info`. On outline that was 253 of its 257 routes, and there
was no row: the reader already owns the right sentence — *mounted somewhere this
cannot read* — and fired it only for a different shape. A wrong address is worse
than a missing one, because it cannot join to the caller that asks for the real
one and it looks as though it could.

## What is read now

| Site | Read as |
|---|---|
| `healthRouter`, installed on the application directly | `GET /health` |
| `documentsRouter.post('/documents.info', …)` | a row: mounted somewhere this cannot read |
| `documentsRouter.post('/documents.list', …)` | the same |

The prefix lives inside the helper's own arguments under the helper's own
meaning, and nothing here knows that meaning. What *is* known is that `api` is
mounted somewhere, which is enough to stop claiming it is served where its routes
are written.
