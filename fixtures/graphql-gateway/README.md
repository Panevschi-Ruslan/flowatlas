# graphql-gateway fixture

GraphQL, both halves (P232): two servers written the two common ways, two
browsers and one server calling them, and every join `static`.

| Service | What it is |
|---|---|
| `orders` | NestJS code-first: `@Resolver(() => Order)` with `@Query`, `@Mutation` and a `@ResolveField` for `Order.customer`, behind a guard; `order` takes its argument through `@Args({ name, type })` |
| `catalog` | Apollo Server standalone: SDL in `schema.graphql`, a resolver map with `Query` and `Product` fields, and a server-to-server graphql-request call to `orders` |
| `web` | React with Apollo Client: `useQuery` of a document with a fragment, of a `.graphql` file imported, `useMutation` of a codegen `PlaceOrderDocument`, a document built at run time, and a field the schema does not have |
| `admin` | Angular with apollo-angular: a `watchQuery` and a `Query` service |

What it shows:

- `flow` from `web`'s `OrdersPage` reaches `Query.orders` and `Order.customer`
  in `orders`, across the repository boundary.
- `impact` on `Order.customer` reaches both browsers' screens.
- `OrderBadge` selects `discount`, which `Order` does not have: a contract
  error at its line.
- `Search` builds its document at run time: a `graphql-document-dynamic` row.
- `OrderSummary` sends the query in `order-summary.graphql`: each field it
  selects is at its line of that file, and `order(id:)` is the argument the
  resolver's options name, so nothing is said of it.
- The fields `Orders` takes from its fragment are at the fragment's lines.
- `catalog`'s `ordered` field asks `orders` for `Query.orders` with
  graphql-request: an `http_calls` from one server to the other's field.

Nothing is installed; every GraphQL package is declared and none is needed.
