# lambda-graphql-values-posted fixture

The catalog of `lambda-graphql-handler` - a GraphQL server made into a Lambda
function, with `POST /catalog` its endpoint - and a scheduled function that
posts it operations the way a small service often does (P279): with
`import fetch from 'node-fetch'`, the body held in a `const`, and the values
written into the document itself. Deployed with the Serverless Framework;
never executed, and nothing is installed.

## The operations

`src/restock/restock.ts` sends three:

- `mutation { addBook(title: "${title}", copies: ${copies}) { id } }`, its body
  `const body = { query }` handed to `JSON.stringify(body)`. A value inside a
  string was already read as a value (P266); a value written bare where an
  argument's value goes, `copies: ${copies}`, now is too, so the document
  parses and the request joins `Mutation.addBook` and the resolver behind it,
  not only the route in front of the function.
- `` `query {\n  book(id: ${bookId}) {...}\n}` ``, on one line with its line
  breaks written as escapes: read as the lines they stand for, joining
  `Query.book`.
- `query { books { ${fields} } }`, whose selection is built at run time: still a
  GraphQL request to the endpoint, with a `graphql-document-dynamic` row saying
  its fields are unread.

Before P279 none of the three was read as GraphQL: `fetch` imported from
`node-fetch` was not the platform's, the body was not an object written in
place, and a bare value made the document fail to parse.

## The addresses read in part

Two requests from the same function are read only in part, and each now has a
`dynamic-http-url` row saying the address is built in part at run time, where
before nothing at all was said:

- `` `${CATALOG_API_URL}/plugins/${plugin}/install${suffix}` ``, read as
  `/plugins/:param/install${…}`. The `plugins` function's `plugins/{proxy+}` is
  keyed `/plugins/:param`, one segment, so it is no catch-all and nothing is
  joined across the unread part. (A route keyed with a final `*` - a framework's
  `[...args]`, `/*` - is joined there, `heuristic`, where no route spelled out
  could answer instead.)
- `` `${CATALOG_API_URL}/reports/${area}-summary` ``, which nothing answers.
