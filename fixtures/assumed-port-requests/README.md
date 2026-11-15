# assumed-port-requests

A Remix storefront and a NestJS GraphQL server, both run on port 3000 on this
machine (P300). Nothing is installed, as in a fresh clone.

## storefront: a port its framework assumes

`package.json` starts the application with `remix dev` and `remix-serve
build`, writing no port, so it listens on Remix's own 3000 as `PORT`'s
fallback (P296): `meta.listen` `{ port: 3000, setting: 'PORT', default: true }`.
`.env.example` sets `STORE_API_URL=http://localhost:3000/store-api`.

| Call | Joined to |
|---|---|
| `listProducts()`, `request(STORE_API_URL, PRODUCTS)` | the server's `POST /store-api` (`graphqlPath`), as a guess: the server's port read through the merge places it at 3000, and the storefront's assumed 3000 yields to it (P305) |
| `addToCart()`, the same for a mutation | the same |
| `readCart()`, `fetch(`${APP_URL ?? 'http://localhost:3000'}/api/cart`)` | nothing: 3000 is the server's, which has no `GET /api/cart`, so the row is `target-route-not-found` (P305). Before the server's port was read, the storefront's assumed port placed it at its own route (P300) |

## server: a port read through a merge

`bootstrap()` listens on `mergeConfig(given).apiOptions.port`. `mergeConfig`
is the repository's own helper laying what it is handed over `defaults`
(`config/defaults.ts`), and `bootstrap()` is handed nothing, so the port is
the defaults' 3000 (P305): `meta.listen` `{ port: 3000, merged:
'src/main.ts:8' }`, a guess. `GraphQLModule.forRoot({ path: '/store-api' })`
serves `Query.products` and `Mutation.addToCart`.
