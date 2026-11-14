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
| `listProducts()`, `request(STORE_API_URL, PRODUCTS)` | the server's `POST /store-api`, the endpoint at the value's path (`graphqlPath`, P281): the storefront serves nothing at `/store-api`, so its assumed port does not place the operation |
| `addToCart()`, the same for a mutation | the same |
| `readCart()`, `fetch(`${APP_URL ?? 'http://localhost:3000'}/api/cart`)` | the storefront's own `GET /api/cart` (`baseUrlValue`): it serves the path, so the port it assumes places the request there (P296) |

## server: a port nothing reads

`bootstrap()` listens on `mergeConfig(given).apiOptions.port`, whose default
is kept in `config/defaults.ts` and merged at run time; nothing reads it, so
no port is said for the server. `GraphQLModule.forRoot({ path: '/store-api' })`
serves `Query.products` and `Mutation.addToCart`.
