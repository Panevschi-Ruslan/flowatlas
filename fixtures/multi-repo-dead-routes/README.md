# multi-repo-dead-routes

Routes nobody calls, told apart (P91). An online bookshop: a catalogue, the
storefront that browses it, a worker that settles orders and a nightly job.
Every route of the catalogue but two is called, each through a shape the reader
used to miss, and the rest are called from outside the project on purpose.

| Route of `catalog-api` | Called by | How |
|---|---|---|
| `GET /items` | `storefront` `ItemsClient.list` | `this.url()`: the helper's suffix defaults to `''` |
| `GET /items` | `orders-worker` `allItems` | `/** @flowatlas-calls catalog GET /items */`, naming the service by its alias |
| `GET /items/:id` | `storefront` `ItemsClient.one`; `orders-worker` `itemFor` | `env.CATALOG.fetch('https://catalog/items/' + id)`: the binding goes to `catalog-worker`, an alias of `catalog-api` |
| `PATCH /items/:id` | `storefront` `ItemsClient.rename`; `orders-worker` `CatalogClient.restock` | a wrapper handed the verb: `req('PATCH', …)` |
| `DELETE /items/:id` | `storefront` `ItemsClient.remove` | `req(HttpVerb.Delete, …)`, an enum member |
| `POST /items/reindex` | `ops-scripts` `reindex` | `fetch(process.env.REINDEX_URL, { method: 'POST' })`: the value in `.env.example` is a whole address, path included |
| `GET /items/:id/price` | nothing read in full | `ItemsClient.variant` asks for `/items/:param/${…}${…}`: **likely-dead**, with that request as its near miss |
| `GET /items/export` | nothing | **dead**: the one actionable row |
| `GET /healthz`, `GET /ready` | the platform | a probe by its path, and by `@HealthCheck()` |
| `POST /webhooks/payments` | the payment provider | a webhook by its path |
| `GET /oauth/callback` | the identity provider | a callback by its path |

`storefront`'s `apiTarget` names `catalog`, an alias, and `orders-worker`'s
`wrangler.jsonc` binds `CATALOG` to `catalog-worker`, the other one. Neither
`orders-worker` nor `ops-scripts` has a way in of its own, and `doctor` says so.

`expected.cli/` holds what `flowatlas dead --kind entries` prints, folded and
with `--class infrastructure`, and as JSON.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/multi-repo-dead-routes/flowatlas.config.json
pnpm flowatlas dead --config fixtures/multi-repo-dead-routes/flowatlas.config.json --kind entries
```
