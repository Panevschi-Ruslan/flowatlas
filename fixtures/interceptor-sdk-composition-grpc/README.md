# interceptor-sdk-composition-grpc

What P280, P285 and P287 left open (P293), read together.

## admin: an Angular interceptor choosing the prefix by the address

`const base = req.url.includes('admin') ? '/office-rest' : '/store-rest'`, and
`url: req.url.startsWith('/assets/') ? req.url : base + req.url` in the clone:
each side is a rewrite of the requests on that side, as the React reader reads
an installed client's interceptor.

| Written | Read as |
|---|---|
| `/admin/users` | `/office-rest/admin/users`, joined |
| `/products` | `/store-rest/products`, joined |
| `/assets/icons.json` | as written: that side writes back `req.url` |
| `'/' + name` | partly read: the test cannot tell from what is read |

## web: callers in class methods, compositions, an SDK through a barrel

- `OrdersStore.load()` and the field `item = (id) => …` call the helper
  `getJson(url)`: each request is drawn from the method, `OrdersStore.load`
  and `OrdersStore.item`, not from the helper.
- `quietQuery = flow(runQuery, …)` held by a field of the class, called in
  `refreshCart()`, hands `runQuery` the `cartLines` document; and
  `flow(runQuery, …)(OrdersDocument)` called where it is made hands it
  `orderList`. Both are drawn at their callers.
- `getSdk` is imported from `./generated`, whose `index.ts` is `export *` of
  two modules nobody committed; the one the configuration's SDK plugin writes
  holds it, so `storeApi.cartLines()` sends `cartLines`.
- `createStoreHooks` is the SWR factory written out again by the
  configuration's `add` plugin, and `useSWRInfinite` writes
  `useOrderListInfinite`, which sends `orderList`.

## stock and checkout: a loader that keeps the contract's field names

Both load `stock.proto` with `keepCase: true`. The way in carries the messages
under their own names (`type:stock#.stock.ReserveRequest@keepCase`, fields
`product_id`, `quantity`, `warehouse_ids`), the call says its keys are the
contract's (`protoFieldNames: 'proto'`), and the contract check matches
`product_id` with its field and says `productId`, a name this loader does not
give it, is not declared.
