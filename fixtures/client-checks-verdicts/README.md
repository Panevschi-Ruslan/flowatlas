# client-checks-verdicts

Two revisions of one project, for what a client already checks in the
verdicts of `flowatlas spec diff` and `what_changed` (P402).

`base/` is the whole project. `head/` holds only the files that differ, laid
over a copy of `base/`; only `catalog` is edited. `scripts/diff-fixture.mjs`
makes each repository a git repository, commits `base`, lays `head/` over it
and commits again, under one author and one date.

- `catalog` (Nest) serves `GET /items` (query `page`), `GET /items/search`
  (query `q`, header `x-tenant`), `GET /items/:id` and `POST /items`, and
  publishes `item.changed` through its own `EventBus.publish`.
- `notifier` (Nest) consumes `item.changed`, switching over `kind` with a
  case for each and a `default` that proves no value is left (`assertNever`).
- `dashboard` (React, axios) sends `page` as a query key, `q` and an `accept`
  header to the search, and switches over an item's `status` with a
  `default`.

| What the head revision changes | What the verdict has to say |
| --- | --- |
| `x-tenant` becomes required on `GET /items/search` | error: the dashboard sends `accept` only |
| `page` becomes required on `GET /items` | info: every caller sends it |
| `item.changed`'s `kind` gains `'archived'` | error: the notifier's switch handles no other value |
| `ItemView.status` gains `'sold'` | warning: the dashboard's `default` takes it; callers deploy first |

`expected.cli/` holds `spec diff` as text and JSON; `expected.mcp/` holds
`what_changed` with its verdict, for the project and for the dashboard.
