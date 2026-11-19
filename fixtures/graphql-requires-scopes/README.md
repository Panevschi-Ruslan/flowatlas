# graphql-requires-scopes

Whether a field using `@requires` carries the scopes the fields it requires
ask, read by which scopes imply which (P261), as `graphql-requires-auth` reads
`@authenticated` (P256).

## The graph

- `catalog` answers `Query.product`; `inventory` resolves `Product.weight`,
  `@requiresScopes(scopes: [["read:weight"], ["staff"]])` - a token with
  `read:weight`, or one with `staff`.
- `shipping` resolves `Product.estimate` and `Product.fragile`, both
  `@requires(fields: "weight")`. `estimate` asks
  `[["read:weight", "read:estimate"]]` - both together - and `fragile` asks
  `[["read:fragile"]]`.
- `router` is the supergraph document the router serves, composed from the
  three. `shop` asks two operations through it, as in `graphql-requires-auth`.

## What the router does

The router reads `scopes` as a list of alternatives, any one of which lets a
request through, each a list of scopes all of which the token must hold. It
checks the client's operation, and a field the planner fetches for a
`@requires` is not in it, so the requiring field must let through only tokens
the required field lets through.

## What the graph says

- No row for `Product.estimate`: every token holding `read:weight` and
  `read:estimate` holds `read:weight`, so what it asks implies what the weight
  asks, though the two are written differently.
- One row at the router, `graphql-requires-auth-not-carried`: `Product.fragile`
  lets through a token holding `read:fragile` alone, which the weight would not,
  so it does not carry `@requiresScopes(read:weight | staff)` on
  `Product.weight`.
- Two `type-unresolved` rows in `shop`: Apollo's client is not installed, as in
  the other federation fixtures.
