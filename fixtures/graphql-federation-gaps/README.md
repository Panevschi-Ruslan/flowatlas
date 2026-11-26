# graphql-federation-gaps fixture

What federation leaves to the resolvers (P252): the router's check on a field
no resolver of its own answers, a field the router does not serve, and an
entity interface whose owner cannot say which of its types an item is.

| Service | What it is |
|---|---|
| `catalog` | Apollo subgraph, standalone on port 4001; owns `interface Product @key(fields: "id")` with `Book`, and writes neither `Product.__resolveReference` nor `__resolveType`; `Book.price` is `@authenticated` and `Edition.year` `@requiresScopes`, and neither has a resolver of its own: `Query.book` answers the price, `Book.details` the edition; `Book.cost` is `@inaccessible @authenticated` |
| `reviews` | Apollo subgraph, standalone on port 4002; `type Product @interfaceObject` adding `reviews`, and `Query.topProducts` |
| `router` | Apollo Router declared by `router/supergraph.graphql` (the same graph composed, with the authorization and `@inaccessible` specifications), and `router/router.yaml` for its path |
| `shop` | React against the router: `BookPage`, `TopBooks` |

What is planned:

- `flow` from `BookPage` reaches `catalog`'s `Query.book` and `Book.details`,
  through the router, and shows on each the router's check for the field it
  answers with no resolver of its own: `@authenticated for Book.price` on
  `Query.book`, `@requiresScopes(catalog:staff) for Edition.year` on
  `Book.details` (read off `Details`, which no resolver answers either). The
  plan edges say which guarded fields each entry answers for this request
  (`meta.answers`), and the checks which they are for (`meta.for`).
- `Query.products` answers a book's price too (it returns the interface), so
  it has the same check for `Book.price`; a request that does not ask for the
  price is shown none.
- `Book.cost` is `@inaccessible`: the router serves no request for it, and no
  check is drawn for it.
- `TopBooks` starts in `reviews`, which knows `Product` only as an interface
  object: the `... on Book` fragment is an entity call for the `Product` to
  `catalog`, which cannot say its type, so the plan edge to `Book.details`
  carries `hop.untyped`.

Rows that remain, on purpose:

- `graphql-entity-type-unsaid` at `catalog`: an entity call for `Product`
  from `reviews` arrives as `{ __typename: "Product" }`, and nothing in
  `catalog` says which of its types the item is.
- `type-unresolved` in `shop` (nothing is installed), and the router's
  `document-age` note.

Nothing is installed; every package is declared and none is needed.
