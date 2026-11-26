# request-lands-on-route fixture

"Which back-end handler does this front-end method's request land on" is one
call (P377). Two repositories and one configuration, so `flowatlas build`
joins them; the configuration names each service otherwise than its
repository's folder (`shop-api` is `./shop-backend`, `shop-admin` is
`./shop-frontend`).

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/request-lands-on-route/shop-frontend/tsconfig.json --noEmit
```

`shop-frontend/node_modules` holds the hand-written stubs for `@angular/core`,
`@angular/common`, `@angular/router` and `rxjs`.

## The back end - `shop-api` (Nest), in `shop-backend/`

- `app.setGlobalPrefix('api')`: every route is served under `/api`, which no
  client path spells out.
- `AdminCatalogController` (`admin/:storeId/catalog`): `GET grouped` and
  `GET :itemId`. `AdminOrdersController` (`admin/:storeId/orders`):
  `POST :orderId/modify`.
- Its `CatalogService` shares a class name with the front end's.

## The front end - `shop-admin` (Angular), in `shop-frontend/`

- `AdminApiService`, the base every client extends, builds
  `${apiUrl}/admin/${storeId}/${resource()}/${path}` and sends through its
  verb helpers `get` and `post`.
- `CatalogService.getGrouped` gets `grouped`; `CatalogService.exportSheet`
  posts to `export`, which no route serves; `DeskOrderService.amendOrder`
  posts to `${orderId}/modify`.
- `/catalog` (`CatalogComponent`) and `/desk` (`DeskComponent`) call them.

## What the graph server answers

- `get_flow` on `CatalogService.getGrouped`: the method, across its request,
  to `AdminCatalogController.grouped`. On `CatalogService`, the two classes as
  candidates, each the call to make.
- `who_calls` on `CatalogService.getGrouped`: the target says
  `requests: [{route: "entry:shop-api:http:GET:/api/admin/:param/catalog/grouped", by: "...AdminCatalogController.grouped"}]`.
  `find_symbol` on `DeskOrderService.amendOrder` says the same on the match;
  `get_source` on `CatalogService.exportSheet` says
  `requestsUnjoined: ["POST ${apiUrl}/admin/:param/catalog/export"]`. The
  screens' methods, which call the clients, say none.
- `search` for `/admin/:rid/orders/${id}/modify` among routes: the modify
  route, whatever the parameters are called and without `/api`.
- `search` with `service: "shop-backend"`: the folder is `shop-api`. With
  `service: "backend"`: the services there are.
