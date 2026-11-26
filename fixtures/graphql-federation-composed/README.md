# graphql-federation-composed fixture

GraphQL federation composed from the subgraphs (P241): a gateway that names
its subgraphs in code, a router read from its own files, and two browsers.

| Service | What it is |
|---|---|
| `gateway` | NestJS `ApolloGatewayDriver` with `IntrospectAndCompose`: `orders` at `process.env.ORDERS_URL`, `customers` at `http://customers:4002/graphql`, `reviews` at a host no configured service is reached at |
| `orders` | Apollo subgraph, federation 1 SDL in code (`extend type Customer @key(fields: "id")` with `id: ID! @external` and `orders`), `buildSubgraphSchema([{ typeDefs, resolvers }])`; its `baseUrlEnv` is `ORDERS_URL` |
| `customers` | Apollo subgraph, federation 2 SDL in a file, mounted at `/graphql`; `Customer` with a reference resolver, and a `Query.status` that `orders` declares too, with neither marking it `@shareable` |
| `router` | Apollo Router, declared by `router/supergraph.yaml` (rover's configuration: `orders` by its endpoint, `customers` by the committed `customers.graphql`), with `router/router.yaml` beside it (the path it serves, and an address it overrides) |
| `web` | React against the gateway |
| `kiosk` | React against the router |

What it shows:

- The gateway's subgraphs are joined as requests are: `orders` by the setting
  its `baseUrlEnv` claims, `customers` by its host, and `reviews` is a
  `graphql-subgraph-not-joined` row. With one subgraph not read, the
  composition is a guess, and every join through the gateway is `heuristic`.
- `flow` from `web`'s `CustomerPage` reaches `customers`' `Query.customer`
  and, by an entity hop, `orders`' `Customer.orders`; `orders` writes no
  reference resolver, so the default one has nothing to draw.
- `Query.status` is a `graphql-composition-conflict` row at each composition,
  and `StatusBar`'s selection of it is drawn to both subgraphs as a choice.
- `flow` from `kiosk`'s `OrdersBoard` goes through the router, `declared`,
  and hops into `customers`' reference resolver for the customer's `name`.
- `impact` on `orders`' `Customer.orders` reaches the screens of both
  browsers, through the gateway and through the router.

Nothing is installed; every package is declared and none is needed.
