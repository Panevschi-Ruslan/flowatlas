# route-order fixture

Which of two routes answers a request, in routers that try routes in the order
they are registered and in routers that rank them (P385). Four repositories
and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/route-order/shop-frontend/tsconfig.json --noEmit
```

`shop-frontend/node_modules` holds the hand-written stubs for `@angular/core`,
`@angular/common`, `@angular/router` and `rxjs`; `catalog-backend/node_modules`
one for `express`; `billing-backend/node_modules` one for
`@nestjs/platform-fastify`.

## `shop-api` (NestJS, the default Express adapter), in `shop-backend/`

NestJS registers routes in declaration order here, and the first that matches
answers.

- `OrdersController` (`orders`): `GET summary` (line 9), `GET :orderId`
  (line 14), `GET latest` (line 20). `summary` is declared above `:orderId` and
  answers; `latest` is declared below it and is never reached.
- `OrderExportsController` (`orders`): `GET export`. `OrdersModule` lists
  `OrdersController` first, so its `:orderId` is registered before `export`,
  which is never reached either.

## `billing-api` (NestJS on `FastifyAdapter`), in `billing-backend/`

- `InvoicesController` (`invoices`): `GET :invoiceId` above `GET overdue`.
  Fastify's router ranks routes by specificity, so `overdue` answers.

## `catalog-api` (Express), in `catalog-backend/`

- `itemsRouter`, mounted at `/items`: `GET /:itemId` above `GET /featured` on
  the same router, so `featured` is never reached.
- `itemExtrasRouter`, mounted at `/items` too, in another file: `GET /new`.
  Which router is tried first is the order of the two `app.use` lines, which
  is not read.

## `shop-web` (Angular), in `shop-frontend/`

`OrdersApi`, `CatalogApi` and `BillingApi` ask for each route by its spelled-out
address; `/dashboard` (`DashboardComponent`) calls them.

## What the graph says

- `OrdersApi.latest`'s and `OrdersApi.exportAll`'s requests land on
  `GET /orders/:param` (`OrdersController.findOne`), the edge's `note` saying
  which route it answers before and `shadows` naming it;
  `CatalogApi.featured`'s lands on `GET /items/:param`. Each joins a handler
  whose response type is not the one the client expects, a contract break.
- `route-shadowed-by-earlier` on `GET /orders/latest`, `GET /orders/export`
  and `GET /items/featured`, each naming both lines and the caller that asked
  for it; `dead` says each route and `OrdersController.latest` are dead.
- `CatalogApi.newest` joins `GET /items/new` as a guess (`heuristic`,
  `orderUnread`), with a `route-order-unread` note at `info`.
- `BillingApi.overdue` joins `GET /invoices/overdue`, chosen for being more
  specific, as Fastify ranks routes.
