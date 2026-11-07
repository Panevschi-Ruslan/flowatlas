# graphql-federation-interfaces fixture

Federation beyond fields and keys (P245): an entity interface and the
`@interfaceObject` that adds to it, an argument filled from a context, the
router's authorization directives, a composed directive, and subgraphs found
by the port their servers listen on.

| Service | What it is |
|---|---|
| `gateway` | Apollo Gateway in code, `IntrospectAndCompose` with `media`, `reviews` and `accounts` at `http://localhost:4001..4003/graphql` and `inventory` at `http://inventory:4004/graphql` |
| `media` | Apollo subgraph, standalone server on port 4001; owns `interface Media @key(fields: "id")` with `Book` and `Movie`, and `Media.__resolveReference`, which answers with the type; `Movie.director` is `@requiresScopes`; composes `@audited` (`@composeDirective`) from a linked specification |
| `reviews` | Apollo subgraph on Express, `app.listen(4002)`; `type Media @interfaceObject` adding `reviews` and `rating` (`@authenticated`) to every Media |
| `accounts` | NestJS schema-first subgraph, `app.listen(process.env.PORT ?? 4003)`; `User @context(name: "viewer")`, `WishItem.price(currency: String @fromContext(field: "$viewer { currency }"))`, `User.email` `@policy` |
| `inventory` | Apollo subgraph, standalone on port 4004 |
| `legacy` | graphql-yoga server, also on port 4004 |
| `router` | Apollo Router declared by `router/supergraph.graphql` (the same graph composed, with `isInterfaceObject`, `@join__implements`, `contextArguments`, the authorization specifications and `@audited`), and `router/router.yaml` for its path; `inventory` at `localhost:4004` |
| `web` | React against the gateway: `ShelfPage`, `TopRated` |
| `kiosk` | React against the router: `MovieCard`, `WishlistPage`, `ItemCard` |

What is planned:

- Every subgraph the gateway names at `localhost:<port>` is joined by the port
  its server listens on, `static`, with no `services[].hosts`: `media` by
  `startStandaloneServer`'s `listen`, `reviews` by `app.listen(4002)`,
  `accounts` by the fallback of `process.env.PORT ?? 4003`; `inventory` by
  its host.
- `flow` from `ShelfPage` reaches `media`'s `Query.media` and
  `Movie.director`, and, by an entity hop for the `Media`, `reviews`'
  `Media.__resolveReference`, `Media.reviews` and `Media.rating` - the last
  selected as `Book.rating`, resolved by the interface object as
  `Media.rating`.
- `TopRated` starts in `reviews`, which cannot say which type a `Media` is:
  the `... on Book` fragment is an entity hop to `media`'s
  `Media.__resolveReference`.
- `flow` from `kiosk`'s `MovieCard` goes through the router, `declared`, and
  shows the router's checks on `Movie.director` (`@requiresScopes(media:staff)`)
  and `Media.rating` (`@authenticated`); the same fields through the gateway
  show none.
- `WishlistPage` reaches `User.currency`, planned for `WishItem.price`'s
  `currency` from the `viewer` context the `User` above it sets, and
  `User.email` behind the router's `@policy`.
- `impact` on `reviews`' `Media.rating` reaches the screens of both browsers.

Rows that remain, on purpose:

- `graphql-auth-not-checked` at the gateway: it composes three fields the
  router's directives guard, and Apollo Gateway checks none of them.
- `graphql-context-not-reached` at `ItemCard`: `wishItem { price }` has no
  `User` above it to fill `currency` from.
- `graphql-subgraph-not-joined` at the router: `localhost:4004` is where both
  `inventory` and `legacy` listen, so it is not one service.
- As in the other federation fixtures: `type-unresolved` in the browsers
  (nothing is installed), `module-import-dynamic` for NestJS's
  `GraphQLModule.forRoot<...>(...)`, and `entry-http-routes-unmatched` for the
  Express servers.

Nothing is installed; every package is declared and none is needed.
