# findings-between-services fixture

What looks broken between the services, listed first by `findings` (P384):
every defect the graph already holds, gated on the fact that makes it a
defect, beside a decoy where that fact does not hold. Three repositories and
one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/findings-between-services/catalog-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-between-services/storefront/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/findings-between-services/legacy-api/tsconfig.json --noEmit
```

## The catalog - `catalog-api` (Nest, `CATALOG_API_URL`)

- `ProductsController` (`products`): `GET :id`, `POST` and `POST :id/publish`
  have `StaffGuard` in front of them; `DELETE :id` has none and deletes a row.
- `StockController` (`stock`): `GET :sku`, no guard here and none beside it,
  reads; only the storefront's server calls it.
- `ProductsService` publishes on `catalog_events` through the project's own
  `EventBus.publish`: `PRODUCT_CREATED` with `productId` and `title`, and
  `LISTING_CANCELLED` (two l's) with `productId`.
- `StockService` publishes on `stock_events`: `STOCK_RESTOCKED`, and a type
  its caller hands it, which is not read.
- `POST /products` reads `body.name` and `body.priceCents`.

## The legacy service - `legacy-api` (Nest, `LEGACY_API_URL`)

- `ItemsController` computes its prefix (`@Controller(prefixOf('items'))`), so
  none of its routes is read (`route-path-dynamic`); `HealthController` is.

## The storefront - `storefront` (Nest)

- `CatalogClient.release` posts `/products/:id/release`: the catalog calls it
  `publish`. `CatalogClient.create` posts `{ productName, priceCents }` to
  `/products`. `CatalogClient.reviews` builds its address at run time and is
  annotated `@CallsService('catalog-api', 'GET /products/:id/reviews')`, a
  route the catalog does not serve.
- `LegacyClient.item` gets `/items/:id` from the legacy service.
- `CatalogEventsService.onCatalogEvent` (`@Consumes('catalog_events')`)
  switches on `evt.type`: under `PRODUCT_CREATED` it reads `evt.productTitle`;
  it waits for `LISTING_CANCELED` (one l).
- `StockEventsService.onStockEvent` (`@Consumes('stock_events')`) waits for
  `STOCK_LOW` and `STOCK_RESTOCKED`.
- `ShopController` (`shop`) is the way in to each client call.

## What it proves

`findings()` lists, first:

| Kind | Row | Nearest fix |
|---|---|---|
| `call-to-missing-route` (high) | `CatalogClient.release` sends `POST /products/:param/release` | `POST /products/:param/publish (one segment off: release for publish)`, met through `POST /shop/products/:param/release` |
| `field-never-sent` (high) | `name` of the body of `POST /products`, read by `ProductsController.create` | `likely renamed: productName is sent, name is read` |
| `field-never-sent` (high) | `productTitle`, read under `PRODUCT_CREATED` | `likely renamed: title is sent, productTitle is read` |
| `type-never-published` (high) | `LISTING_CANCELED` on `catalog_events` | `likely renamed: LISTING_CANCELLED is published, LISTING_CANCELED is handled` |
| `unguarded-among-guarded` (medium) | `DELETE /products/:param`, while 3 of the 3 other routes of `ProductsController` have `StaffGuard` | |
| `annotation-to-missing-route` (high) | `@CallsService points at GET /products/:id/reviews` | `GET /products/:param (one segment off: reviews added)` |

then `GET /stock/:param` under `unguarded` (low: only another service sends
it) and `LISTING_CANCELLED` under `message-type-unselected`.

Held back, never listed (`heldBack`): the legacy call, since the legacy
service's items routes were not read (`some routes of legacy-api were not read
(route-path-dynamic)`), and `STOCK_LOW`, since a publish on `stock_events`
sends a type not read and may be it.
