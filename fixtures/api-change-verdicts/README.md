# api-change-verdicts

Two revisions of one project, for what an API or message change does to the
code that uses it (P390): `flowatlas spec diff`, `flowatlas diff --spec` and
the pull request's comment and SARIF log.

`base/` is the whole project. `head/` holds only the files that differ, laid
over a copy of `base/`; only `catalog` is edited. `scripts/diff-fixture.mjs`
makes each repository a git repository, commits `base`, lays `head/` over it
and commits again, under one author and one date.

Four repositories, joined by one configuration:

- `catalog` (Nest) serves `POST /items`, `GET /items`, `GET /items/:id`, `DELETE /items/:id`,
  `GET /items/:id/archive`, `POST /drafts` and `POST /stock/:itemId/recount`,
  and publishes `item.changed` and `stock.changed` through its own
  `EventBus.publish`, which the configuration describes as a producer.
- `storefront` (Nest) calls the catalog through `CatalogClient` (`CATALOG_URL`)
  from its own routes: `POST /shop/items` creates an item with `{ name, price }`,
  `POST /shop/drafts` keeps a draft with `{ title }`, `DELETE /shop/items/:id`
  removes one, `GET /shop/items/:id` reads one.
- `notifier` (Nest) consumes both channels: `NotifyService.onItemChanged`
  reads `itemId`, `label` and `name`; `AuditService.onStockChanged` spreads the
  whole message into a record and reads no field by name.
- `dashboard` (React, P393) calls the catalog from the browser
  (`VITE_CATALOG_URL`): `ItemPage` reads `name` and `price` of
  `GET /items/:id`, `ItemsList` the `name`, `badge` (behind `??`) and `stock`
  of each row of `GET /items`.

Each edit is planted beside a decoy whose evidence does not hold:

| What the head revision changes | What the verdict has to say |
| --- | --- |
| `CreateItemBody` gains a required `currency` | error: the storefront's request sends `name` and `price`, no `currency` |
| decoy: `DraftBody.title` becomes required | info: the storefront's request always sends `title` |
| `item.changed` loses `label` | error: `NotifyService.onItemChanged` reads it, line 16; consumers deploy first |
| decoy: `item.changed` loses `legacyCode` | info: no consumer reads it, among 1 |
| `stock.changed` loses `warehouse` | warning: its consumer takes the message whole (spread), so whether it reads `warehouse` is not known |
| `ItemView` loses `price` on `GET /items/:id` | error: the dashboard's `ItemPage` reads it, line 13; the storefront's request is not followed (P393) |
| `ItemView` loses `price` on `POST /items` | warning: only the storefront's server-side request calls it, and which fields its client reads is not read; said, never guessed |
| decoy: `ItemRow` loses `thumbnail` (`GET /items`) | info: the dashboard reads each row's `name`, `badge` and `stock`, not `thumbnail`, among 1 caller (P393) |
| `ItemRow.stock` becomes optional (`GET /items`) | warning: `ItemsList` reads `stock` with no check that it is there (P400) |
| decoy: `ItemRow.badge` becomes optional (`GET /items`) | info: `ItemsList` reads `badge` only behind `??`, so it copes without it (P400) |
| decoy: `ArchivedItemView` loses `reason` | info: nothing in the three repositories calls `GET /items/:id/archive` |
| `DELETE /items/:id` is removed | error: the storefront calls it; placed on the nearest line of the controller that is still there, since a pull request is annotated only on lines it holds |

`expected.cli/` holds `spec diff` as text, Markdown, JSON and SARIF (each
change with its direction, its verdict from use, its deploy order, the flow
from the storefront's way in through the catalog to the notifier as a code
flow, and the consumers as related locations), and the API section of the
pull request's comment with the coverage line in its header.
