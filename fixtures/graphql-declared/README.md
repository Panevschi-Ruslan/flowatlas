# graphql-declared fixture

A GraphQL service declared by its schema, in place of its source (P232), and a
React shop that queries it. `catalog.graphql` is the same SDL
`fixtures/graphql-gateway/catalog` is built from, so the root entries here -
`Query.products`, `Query.product` - are the ones that fixture reads from
`catalog`'s code, declared by the document instead of drawn from a resolver.

The shop's request joins the declared endpoint and its selection joins
`Query.products`, as it would join the server read from source.
