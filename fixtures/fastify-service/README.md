# fastify-service fixture

One Fastify service, read by the same table row as Express and Koa.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/fastify-service/tsconfig.json --noEmit
```

`node_modules` holds hand-written stubs for `fastify` and `pg`.

## What is Fastify's own

Two things on its row that no other framework here needs.

**Mounting is a plugin.** `app.register(ordersRoutes, { prefix: '/orders' })`
hands a function an instance already scoped to the prefix, so the application
the routes are declared on is that function's first parameter rather than a
value passed in. `src/orders/orders.routes.ts` never says `/orders`.

**A route can be one object.** `app.route({ method, url, handler })` is the form
Fastify's own documentation leads with, and a repository written that way would
otherwise read as having no routes at all.

Route middleware is a key of an options object between the path and the handler
(`{ preHandler: [requireAdmin] }`) rather than a further argument, and what
stands in front of a whole application is a hook whose first argument names the
moment it runs (`app.addHook('onRequest', authenticate)`).

## The routes

| Site | Entry | `handlerVia` | `meta.middleware` |
|---|---|---|---|
| `app.get('/health', …)` | `GET /public/health` | `inline` | none |
| `app.get('/summary', …)` | `GET /public/summary` | `inline` | none |
| `app.get('/', listOrders)` | `GET /orders` | `function` | `authenticate`, `withTenant` |
| `app.get('/:orderId', …)` | `GET /orders/:param` | `inline` | the same two |
| `app.post('/', { preHandler: [requireAdmin] }, …)` | `POST /orders` | `inline` | the same two, then `requireAdmin` |
| `app.route({ method: 'DELETE', … })` | `DELETE /orders/:param` | `inline` | the same two |
| `app.get(archivePath('old'), …)` | none | — | `route-path-dynamic` |

## What is not read

`@fastify/autoload` registers a whole directory and takes each prefix from the
directory's name. That is a file-system router — the same fact Next.js and Remix
are — so it is not read, and a repository using it has its routes reported as
declared on an application whose base cannot be told from here rather than
recorded at the paths they are written at. `fastify/demo` is written that way,
and gives fourteen such rows and no routes.
