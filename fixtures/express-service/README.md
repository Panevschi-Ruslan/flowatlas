# express-service fixture

An Express service and a browser calling it. Two repositories, one
configuration, so `flowatlas build` joins them.

The point of it is P15: a route registered by a call, on the framework the
reader was designed around. Everything here is a shape taken from a real
repository — `directus/directus` and `larswaechter/expressjs-api` — rather than
invented for the test.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/express-service/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/express-service/web/tsconfig.json --noEmit
```

`api/node_modules` holds hand-written stubs for `express` and `pg`;
`web/node_modules` holds ones for `@angular/core`, `@angular/common/http` and
`rxjs`.

## The routes

| Site | Entry | `handlerVia` | `meta.middleware` |
|---|---|---|---|
| `router.get('/health', …)` | `GET /public/health` | `inline` | none |
| `router.get('/summary', …)` | `GET /public/summary` | `inline` | none |
| `ordersRouter.get('/', listOrders)` | `GET /orders` | `function` | `express.json()`, `authenticate`, `withTenant` |
| `ordersRouter.get('/:orderId', …)` | `GET /orders/:param` | `inline` | the same three |
| `ordersRouter.post('/', requireAdmin, …)` | `POST /orders` | `inline` | the same three, then `requireAdmin` |
| `ordersRouter.delete(archivePath('old'), …)` | none | — | `route-path-dynamic` |

## Order is the whole of it

`api/src/app.ts` mounts `/public` before it installs anything, and `/orders`
after `express.json()` and `authenticate`. Neither router says a word about
either. What decides whether a request to a route can be refused is the position
of the mount relative to the installs above it, in a file the route is not
written in — which is why the reader puts every call on an application in order
before it reads a single route.

`ordersRouter.use(withTenant)` is the same fact one level down: middleware on a
router, inherited by the routes declared after it.

## What the audit says

`GET /public/summary` reads stored data with nothing in front of it, and is
reported. No route under `/orders` is, because `authenticate` is. That is the
one question this fixture exists to answer, and the answer is in
`expected.link-report.json`.

## The prefix, and where it comes from

`publicRouter` is exported by default and imported under a name of `app.ts`'s
choosing; `ordersRouter` is exported by name. Both have to arrive at the same
declaration as the routes written on them, or the mount that places them reaches
nothing — which is what `GET /health` rather than `GET /public/health` would
mean.

## The browser

`web/src/app/orders-api.service.ts` writes `${environment.apiUrl}/orders`, and
`apiTarget` names `api`, so both requests join the routes. `POST /orders` is the
one with a declared body: `Request<unknown, unknown, CreateOrder>`. Most Express
handlers declare no shape at all, and the two `GET`s here do not, which is the
honest state of the framework rather than an omission.
