# rewrite-branches-composed-sends

What P280, P281 and P275 left open (P285), read together.

## web: rewrites chosen by the request's own address

| Written | Read as |
|---|---|
| `config.baseURL = config.url.startsWith('/admin') ? '/office-rest' : '/store-rest'` | `/admin/users` goes to `/office-rest/admin/users`, `/products` to `/store-rest/products`; `'/' + section + '/list'` cannot answer the test and is partly read |
| `ApiClient.get(path)` over an instance made with `/store-rest` whose interceptor sets `/exports` for an address ending `.csv` | `/orders.csv` goes to `/exports/orders.csv`, `/orders` to `/store-rest/orders`: the test is put to each call of the class |

## web: GraphQL sends through a composition and an SDK under other names

- `runQuietQuery = flow(runQuery, …)` (fp-ts): each call of `runQuietQuery`
  hands `runQuery` its document, so `Orders` and `Order` are drawn at their
  callers, the second from the helper since a class method is no function the
  reader indexes.
- `createStoreApi` is `getSdk` re-exported under another name, and
  `getSdkWithHooks` spreads it; `storeApi.SignIn(…)` and the hook
  `storeHooks.useOrders(…)` send `SignIn` and `Orders` to `/shop-graphql`.

## api: a documented default the configuration overrides

`path: config.apiOptions.storePath` documents `@default 'store-api'`;
`app-config.ts` writes `storePath: 'shop-graphql'` in an `AppConfig`, so the
endpoint is `POST /shop-graphql` with an info row saying where the value was
read. The e2e configuration's `test-api` is not the application's.

## worker: a server's request to a host no service is reached at

`CATALOG_URL` is `https://catalog.example.test/api/catalog`; the request for
`/items/:param` is joined, as a guess, to the one route serving it under the
value's path, `GET /api/catalog/items/:id`. `RATES_URL`'s path is served by
nothing and stays a third party.
