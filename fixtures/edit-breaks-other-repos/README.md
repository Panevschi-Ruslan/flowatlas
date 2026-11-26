# edit-breaks-other-repos fixture

An edit in one repository that breaks code in another, caught while it is
made and before it is committed (P387). Three repositories and one
configuration, so `flowatlas build` joins them; `edits/` holds the files an
assistant changes afterwards, laid over a built copy by
`scripts/edit-fixture.mjs`.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/edit-breaks-other-repos/catalog-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/edit-breaks-other-repos/storefront/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/edit-breaks-other-repos/alerts-bot/tsconfig.json --noEmit
```

## `catalog-api` (Nest)

- `ItemsController`: `GET /items`, `GET /items/:id`, `PATCH /items/:id/archive`
  (reads `body.reason`) and `POST /items/:id/take`. A second controller in the
  same file, `TagsController`, declares `GET /tags` on a line that reads the
  same as `GET /items`'s (`@Get()`, then `list(): …`).
- `ItemsService.take` publishes `{ type: 'STOCK_LOW', sku, remaining }` on
  `stock_events` through the project's own `EventBus.publish`, which the
  configuration describes as a producer.

## `storefront` (Nest)

- `CatalogClient` calls `GET /items`, `GET /items/:id` and
  `PATCH /items/:id/archive` with `{ reason }` through `CATALOG_API_URL`;
  `ShopController`'s three routes hand on to it.

## `alerts-bot` (Nest)

- `StockAlerts.onStock` is marked `@Consumes('stock_events')`, returns unless
  the type is `STOCK_LOW`, and reads `evt.sku` and `evt.remaining`.

## The edits

- `edits/catalog-api/src/items/items.controller.ts`: the archive route renamed
  `@Patch(':id/retire')`.
- `edits/catalog-api/src/items/items.service.ts`: `sku` sent under another key,
  `itemCode: sku`.

## What it proves

- The edit index `build` writes (`edits.json`) holds, per file, each name
  another repository uses, as the file spells it: the routes the storefront
  calls (`GET /items` by its first three lines, the only way to tell it from
  `GET /tags`), the type and channel the bot takes, the fields each side sends
  and reads.
- The edit hook names the storefront's `CatalogClient.archive` for the route
  renamed (edited, or the whole file written), and the bot's
  `StockAlerts.onStock` for `sku` sent under another key; it says nothing for
  an edit to `GET /tags`, which nothing elsewhere calls, or to a line no other
  repository reads.
- `check_change` reads only `catalog-api` again and answers `unsafe`: the
  storefront's call lost its route, a removed way in is still called from
  another service, and `DELETE /shop/items/:param` reaches the change.

Snapshots: `expected.mcp/` (`node scripts/mcp-snapshots.mjs`).
