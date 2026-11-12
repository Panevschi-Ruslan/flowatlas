# graphql-requires-auth

The router's check on a field it fetches only for a `@requires` (P256).

## The graph

- `catalog` answers `Query.product`; `inventory` resolves `Product.weight`,
  marked `@authenticated`; `shipping` resolves `Product.estimate` and
  `Product.fragile`, both `@requires(fields: "weight")`. `fragile` carries
  `@authenticated` too; `estimate` does not.
- `router` is the supergraph document the router serves, composed from the
  three; it checks the router's authorization directives.
- `shop` asks two operations through the router: `Estimate` selects `name` and
  `estimate`, `Weight` selects `weight` and `estimate`.

## What the router does

The router applies its authorization directives to the client's operation:
a field the request may not read is taken out of the operation before it is
planned. A field the query planner adds to satisfy a `@requires` is not in the
client's operation, so it is fetched without being checked. Composition
(Federation 2.9 and later) refuses a supergraph where a field using
`@requires` does not carry the authorization requirements of the fields it
requires, for that reason.

## What the graph says

- `Estimate`: the step to `inventory`'s `Product.weight` is a fetch for
  `Product.estimate` (`meta.graphql.requiredBy`), and `flow` shows no
  `@authenticated` in front of it (`expected.cli/flow.shipping.tree.txt`).
- `Weight`: the client selects `weight` itself, so the same step is the
  client's selection and shows the check (`expected.cli/flow.weight.tree.txt`),
  though the planner also fetches it for `estimate`.
- One row at the router, `graphql-requires-auth-not-carried`: `shipping`
  resolves `Product.estimate` with `@requires(fields: "weight")`, and
  `Product.estimate` does not carry `@authenticated` on `Product.weight`.
  `Product.fragile` carries it, and is said nothing about.
- Two `type-unresolved` rows in `shop`: Apollo's client is not installed, as in
  the other federation fixtures.
