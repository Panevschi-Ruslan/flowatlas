# graphql-codegen-sdk

A NestJS server serving two GraphQL APIs made by one function of its own, and
two front ends calling them through the SDK GraphQL Code Generator writes
(P281): `getSdk(requester)` from `typescript-generic-sdk`, and `getSdk(client)`
from `typescript-graphql-request`.

Nothing is installed, as in a fresh clone.

## api: two APIs from one function

`configureApi(getOptions)` returns `GraphQLModule.forRootAsync({ useFactory })`,
whose factory answers `createOptions(settings, getOptions(settings))`, an async
function of the repository returning `{ path: '/' + options.apiPath, include:
[options.resolverModule] }`. `AppModule` calls it twice:

| Call | Read as |
|---|---|
| `configureApi((settings) => ({ apiPath: settings.api.storePath, resolverModule: StoreApiModule }))` | `POST /store-api`, serving `StoreResolver`; the path is the `@default 'store-api'` of `ApiSettings.storePath`, said by an info `graphql-endpoint-unread` row |
| `configureApi((settings) => ({ apiPath: settings.api.officePath, resolverModule: OfficeApiModule }))` | `POST /office-api`, serving `OfficeResolver` |

`Mutation.signIn` is a field of both, kept apart as `Mutation.signIn@/store-api`
and `Mutation.signIn@/office-api`.

`StatusServer` makes an Express application with `require('express')` inside a
method: `GET /status` is read; `app.get(config.route || '/ready', ...)` is a
`route-path-dynamic` row.

## shop: a committed generic SDK

`app/generated/graphql.ts` is committed; `app/api-client.ts` hands
`getSdk` its `requester`, which calls `postOperation`, which posts to `API_URL`,
`process.env.STORE_API_URL` with a public fallback. `.env.example` sets
`STORE_API_URL=http://localhost:3000/store-api`; `wrangler.toml` sets the
public demo host.

| Call | Joined to |
|---|---|
| `api.signIn({ email }, options)` | `POST /store-api` and `Mutation.signIn@/store-api`, `heuristic` via `graphql-path` from the value for this machine |
| `api.cart({}, options)`, written over two lines | `Query.cart@/store-api` |
| `api.payByCard({}, options)` | nothing: the store API declares no `Mutation.payByCard` (a plugin the server may load adds it), a `graphql-field-no-resolver` row |

The `fetch` in `postOperation` itself keeps its `api-path-dynamic` row: `API_URL`
is a `let` the platform may reassign.

## kiosk: an SDK nobody committed

`src/generated/sdk.ts` is written at install from the documents `codegen.ts`
lists; `src/client.ts` hands `getSdk` a `GraphQLClient` made with
`` `${import.meta.env.VITE_OFFICE_URL}/office-api` ``, which `apiTarget` names
`api`.

| Call | Joined to |
|---|---|
| `officeSdk().StaffList()` | `Query.staff@/office-api`, the operation `StaffList` of `src/gql/Staff.graphql` |
| `officeSdk().SignIn({ email })` | `Mutation.signIn@/office-api` |
| `officeSdk().ArchiveStaff({ id })` | the endpoint only: no document declares `ArchiveStaff`, a `graphql-document-dynamic` row |
