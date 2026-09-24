# koa-service fixture

One Koa service, read by the same table row as Express and Fastify.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/koa-service/tsconfig.json --noEmit
```

`node_modules` holds hand-written stubs for `koa`, `@koa/router` and `pg`.

## What is Koa's own

**The application declares no route.** The verbs are on `@koa/router`, and the
Koa application is read only because it is where the middleware in front of a
whole router is installed. Reading the router alone would find every route and
miss the only guard in the repository, which is exactly what happens in
`javieraviles/node-typescript-koa-rest`: `app.use(jwt(…))` sits between the
public router and the protected one, and nothing in either router's file
mentions a token.

**The prefix is the constructor's.** `new Router({ prefix: '/orders' })` rather
than a path at the place the router is installed, which is why a prefix can be
an option on this row and is an argument on every other one.

**A router is installed as the middleware it turns itself into**, and usually
twice: `app.use(router.routes()).use(router.allowedMethods())`. Both are the
same router arriving at the same place, and an application asked for its base
twice has to answer twice — a walk that treats the second ask as a cycle reports
every route in the repository as mounted somewhere it cannot read.

`del` is the alias for `delete`, which is a reserved word, and answers the same
verb.

## The routes

| Site | Entry | `handlerVia` | `meta.middleware` |
|---|---|---|---|
| `publicRouter.get('/health', …)` | `GET /public/health` | `inline` | none |
| `publicRouter.get('/summary', …)` | `GET /public/summary` | `inline` | none |
| `ordersRouter.get('/', listOrders)` | `GET /orders` | `function` | `authenticate`, `withTenant` |
| `ordersRouter.get('/:orderId', …)` | `GET /orders/:param` | `inline` | the same two |
| `ordersRouter.post('/', requireAdmin, …)` | `POST /orders` | `inline` | the same two, then `requireAdmin` |
| `ordersRouter.del(archivePath('old'), …)` | none | — | `route-path-dynamic` |
