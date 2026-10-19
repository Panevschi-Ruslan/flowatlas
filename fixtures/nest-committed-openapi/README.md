# nest-committed-openapi

One NestJS service, `shop`, whose repository commits an OpenAPI document it
writes by hand (`shop/openapi.yaml`), for `flowatlas spec --against` and the
"Committed API documents" section of `flowatlas contracts` (P195).

The configuration lists the document under the service's `apiDocuments`; the
code is what is read, and the document is checked against it.

| In the document | In the code | What is said |
|---|---|---|
| `GET /products`, `?page` an optional `integer`, `200` | `@Get()`, `@Query('page') page?: number` | nothing: `integer` is `number` on the wire, and an optional parameter is optional (P197) |
| `POST /products`, `NewProduct` body, `201` | `@Post()`, `CreateProductDto` | nothing: the success status and the component names are the document's own words |
| `GET /products/{productId}` | `@Get(':id')` | nothing: a path parameter is matched by position, not by name |
| `DELETE /products/{productId}` | - | an error at the document's `delete:` line: the code no longer answers it |
| - | `@Get(':id/reviews')` | said: the code answers it, the document does not say it |

`expected.cli/` holds what `spec --against shop` prints in each format and
what `contracts` adds (`scripts/cli-snapshots.mjs`); the claims are tested in
`packages/cli/src/commands/spec-against.test.ts`.
