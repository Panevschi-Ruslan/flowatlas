# graphql-federation fixture

GraphQL federation with the supergraph in a file (P241): a gateway, two
subgraphs written two ways, and a browser whose operations are planned through
the gateway into the subgraph that resolves each field.

| Service | What it is |
|---|---|
| `gateway` | Apollo Gateway handed `supergraph.graphql` with `readFileSync(join(__dirname, '..', 'supergraph.graphql'))`, served at `/graphql` by Express |
| `orders` | Apollo subgraph (`buildSubgraphSchema`), federation 2 SDL with `@link` imports: `Query.orders`, `Mutation.placeOrder`, `Order @key(fields: "id")` with its reference resolver and `Order.customer`, `Customer.orders` contributed to the customer entity with a reference resolver, and a shareable `Query.regions` |
| `customers` | NestJS code-first `ApolloFederationDriver` (federation 2): `@Directive('@key(fields: "id")')` on `Customer`, `@ResolveReference()`, `Query.customer`, `Customer.internalNote` marked `@inaccessible`, and the same shareable `Query.regions` |
| `web` | React with Apollo Client against the gateway |

What it shows:

- `flow` from `OrdersPage` goes through the gateway's endpoint to both
  subgraphs, and reaches `orders`' `Query.orders` and `Order.customer`, then
  `customers`' `Customer.__resolveReference` for the customer's `name` and
  `email`: an entity hop, `static`, since the supergraph is read whole.
- `CustomerPage` hops the other way: `customers`' `Query.customer`, then
  `orders`' reference resolver and `Customer.orders`.
- `impact` on `customers`' reference resolver reaches `OrdersPage`.
- `RegionPicker` selects `Query.regions`, which both subgraphs resolve: drawn
  to both as a choice, `heuristic`, with an info row.
- `OrderBadge` selects `discount`, which no subgraph has, and `CustomerNote`
  selects `internalNote`, which the composition hides: two contract errors.
- The supergraph still names `Order.status`, which `orders` no longer
  declares: a `graphql-supergraph-drift` row.

Nothing is installed; every package is declared and none is needed.
