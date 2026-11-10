# service-package-types

A workspace of three configured services: a NestJS API (`apps/api`) serving
GraphQL at `/graphql` and REST under a `v1` prefix, a storefront that declares
nothing of it, and a back office that declares the API's package
(`"@shop/api": "workspace:^"`) to import its `Order` type and one helper (P282).

A service is its own directory and the workspace packages it declares, and
every reader walks every file of that extent. So the back office read the API's
resolvers and controllers as ways in of its own: two services answered
`POST /graphql`, the storefront's query was `ambiguous-route-target` between
them, the back office's mutation joined its own copy of the resolver, and the
copies stood at addresses the API never serves (`/health`, without the API's
prefix).

What is written in another configured service's package is now that service's
way in, read there and nowhere else (`withoutOtherServicesWaysIn` in
`packages/core/src/other-services.ts`). The rest of the package is still read
by the service that declares it.

What to watch:

- Ways in only in `api`: `Query.orders`, `Mutation.cancelOrder`, `POST /graphql`,
  `GET /v1/health`, and `GET /v1/catalog/:param` from the `@shop/catalog`
  library the API declares (a library's controller is still its declarer's).
- No `entry` node in `backoffice`, and none for the catalog either: the back
  office reaches `@shop/catalog` only through the API's package, so what is
  written there came with the API.
- `backoffice#../api/src/orders/order-number.ts:orderNumber` and
  `backoffice#../../packages/formatting/src/index.ts:statusLabel` are still
  functions of the back office: code of the API's package it calls, and a
  library it declares itself.
- Both front ends' GraphQL operations join `api`'s fields; no
  `ambiguous-route-target` row.
