# graphql-endpoints fixture

One NestJS server serving three GraphQL schemas at three paths, and a React
front end whose operations are sent with three clients (P266).

| Service | What it is |
|---|---|
| `api` | NestJS with three `GraphQLModule`s: the storefront at `/graphql` (options from a `useClass`, path from an enum), settings at `/settings` (options from a `useFactory`), operators at `/admin` (`forRoot` with `include: [AdminModule]`). The first two serve the resolvers tagged with the scope their options name, by the repository's own `StoreResolver` / `SettingsResolver` decorators applying `SetMetadata`. Both of those schemas have a `Query.me`. The storefront's schema has a plugin of the repository's that answers some requests itself. |
| `web` | React with Apollo Client: the page is wrapped in a client of `${SERVER_URL}/settings`, made by a factory that writes `/graphql` as its default; the cart's operations hand the storefront's client, handed down by a context provider; the stores page hands an admin client made with an `HttpLink`; a report hands a client its parent passes in. `seed.ts` posts a document through a helper of its own. |

What it shows:

- Three endpoints, `POST /graphql`, `POST /settings` and `POST /admin`, each
  carrying only its own root fields; every field entry keyed by its path, so
  `Query.me@/graphql` and `Query.me@/settings` are two ways in.
- `SERVER_URL` is decided where the page is served, so every operation's
  address is `/${…}/settings`-like: each joins the one endpoint whose path the
  read rest names (`via: graphql-path`, `heuristic`), and its fields only that
  schema's: the settings page's `me` reaches the operator's `me`, the cart's
  the shopper's.
- The cart's `Products` asks the storefront for `Query.products`, which no
  resolver declares: a `graphql-field-no-resolver` note naming the plugin, and
  no contract error.
- `OrdersToday` hands a client nothing follows: `graphql-client-unread`, and
  its address is not read. `Query.ordersToday` is resolved in a module and with
  a decorator no schema serves: `graphql-endpoint-unread`.
- `seed.ts` hands `graphqlRequest('/settings', ...)` a document with a value
  interpolated into one of its strings: read, and joined to
  `Mutation.renameShop@/settings`, `static`, through the settings key.

Nothing is installed; every package is declared and none is needed.
