# lambda-graphql-handler fixture

A catalog served by a GraphQL server made into a Lambda function, and a scheduled
function that sends it an operation (P269). Deployed with the Serverless
Framework; never executed, and nothing is installed.

## The server

`src/catalog/index.ts` is the whole of the function's handler:

```ts
export const server = new ApolloServer({ resolvers, typeDefs }).createHandler();
```

No function of this repository is named there, and before P269 the function was
an `invoke` entry with a `function-handler-unread` row and nothing else: the
server's fields were not ways in, because `apollo-server-lambda` was not among
the packages a GraphQL server is read for, and the route in front of the
function was a route with nothing behind it.

Now the function's handler is read as the server (`handlerVia: graphql`), each
field its resolver map answers is a `graphql` entry handled by its resolver, and
the route the deployment puts in front of the function, `POST /catalog`, is the
server's endpoint, carrying its schema. No `POST /graphql` is drawn: the server
answers at no path of its own.

`src/catalog/resolvers.ts` puts the map together a type at a time,
`Query: { ...bookResolvers.Query, ...authorResolvers.Query }`, and
`resolvers/authors.ts` hands its resolver over by its name, `{ author }`. Both
are read: `Query.book`, `Query.books`, `Query.author` and `Mutation.addBook`.

## The caller

`src/restock/restock.ts` posts a `mutation AddBook` to
`${CATALOG_API_URL}/catalog`, and the configuration says `CATALOG_API_URL` is
this service's. The request joins `POST /catalog`, and the field it selects
joins `Mutation.addBook`, the resolver behind it and the store it saves to.
