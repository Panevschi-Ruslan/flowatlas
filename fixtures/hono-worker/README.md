# hono-worker fixture

One repository serving routes from two frameworks, and a browser calling both.
Two repositories and one configuration, so `flowatlas build` joins them.

The point of it is R15: a route is a route whoever declared it. `api` is a Nest
application with a worker in front of it — controllers in `src/orders/`, a
`Hono` application in `src/worker.ts` — and it is configured as one service with
one `type`, because a repository has one **reader** and any number of
frameworks. Nothing about how the Nest half is read may change because the
worker half exists, which is why the controller is here at all.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/hono-worker/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/hono-worker/web/tsconfig.json --noEmit
```

`api/node_modules` holds a hand-written stub for `hono`; `web/node_modules`
holds ones for `@angular/core`, `@angular/common/http` and `rxjs`. `api` reaches
the real `@nestjs/common` types through the shared fixture manifest.

## The chain, end to end

```
click Watch             web/src/app/orders.component.ts:10
  GET /depots/:param/stream                   hits, static
    entry GET /api/depots/:param/stream       api/src/worker.ts:27
      orderStream                                  handles, static
        OrdersService.changesFor                   calls, static
```

The browser writes the address without `/api`, because its base already ends
there. The worker writes `/api` out in the path, because nothing adds it to a
route declared outside the framework that has a global prefix. They meet because
the linker retries a request that matched nothing with the prefix the service's
own routes carry.

## The worker — `api/src/worker.ts`

Seven of the repository's nine routes, the two refusals, and the calls on the
application that declare no route at all.

| Site | Line | Entry | `handlerVia` |
|---|---|---|---|
| `app.use('*', requestLogger)` | 20 | — | middleware, not a way in |
| `app.get('/health', (c) => …)` | 23 | `GET /health` | `inline` |
| `app.get('/api/depots/:depotId/stream', orderStream)` | 27 | `GET /api/depots/:param/stream` | `function` |
| `app.get('/api/depots/:depotId/menu-stream', menuStream)` | 28 | `GET /api/depots/:param/menu-stream` | `function` |
| `app.post('/api/messenger/webhook', withNest, …)` | 34 | `POST /api/messenger/webhook` | `inline`, `meta.middleware: ["withNest"]` |
| `app.on('DELETE', '…/cache', …)` | 42 | `DELETE /api/depots/:param/cache` | `inline` |
| `app.get(pathFor('stats'), …)` | 45 | none | `route-path-dynamic` |
| `app.route('/api/admin', adminRoutes)` | 48 | two, declared in another file | — |
| `app.basePath('/internal')`, then `.post('/reload', …)` | 51‑52 | `POST /internal/reload` | `call` |
| `registerReports(app)` | 56 | none | `route-path-dynamic` |
| `app.all('/api/*', …)` | 65 | `ALL /api/*` | `call` |

The receiver's type is what makes a call a route, and the type has to be the
application: `c.get('orders')` in `src/stream/sse.ts` is written on a receiver
from the same package and declares nothing. `app.use` and `app.route` are on the
application and are not routes either.

`GET /health` carries no `/api`, and that is not an oversight — the real worker's
probe route does not either. A prefix a route does not declare is not added.

## Where a route is really served — `api/src/admin/`

`admin.routes.ts` declares `/events` and `/orders/:orderId` on a sub-application
and says nothing about where it hangs. `worker.ts:48` mounts it at `/api/admin`,
so both are recorded a level down: `GET /api/admin/events` and
`GET /api/admin/orders/:param`. Reading the declaration on its own would have put
them at an address nothing serves.

`reports.routes.ts` is the refusal. Its routes are declared on an application
that arrives as an argument, and this repository does move applications about —
`basePath` in one place, `route` in another — so where `/daily` is answered
depends on the caller. One `route-path-dynamic` row, and no route. Where a
repository shifts nothing, an application handed in as an argument serves what it
declares and its routes are recorded without a row.

## The bridge — `ALL /api/*`

`worker.ts:65` hands everything under `/api` it did not answer to the Nest
application, and the routes behind it are the controllers, which are in the
graph already. It is a declared route and it gets an entry point, but it must
never be the route a request is joined to when a controller spells that address
out. Both of the browser's calls prove it:

| Called | Answered by | Not by |
|---|---|---|
| `GET /depots/:param/stream` | `GET /api/depots/:param/stream`, the worker's | `ALL /api/*` |
| `GET /depots/:param/orders` | `GET /api/depots/:param/orders`, the controller's | `ALL /api/*` |

Counting holes made those ties, because `/api/*` and `/api/depots/:param/orders`
have one hole each. A `*` opens the rest of the address and a `:param` opens one
segment of it, so they are ranked apart: see `matchRoute` in the linker.

## The Nest half — `api/src/orders/`

`OrdersController` under `@Controller('depots/:depotId/orders')`, with
`setGlobalPrefix('api')` in `main.ts`. Two routes, `meta.globalPrefix: "api"`,
handled by methods — exactly what this fixture would produce with the worker
adapter turned off, which is what
`packages/cli/src/commands/two-frameworks.test.ts` asserts by reading it both
ways and comparing.
