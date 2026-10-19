## flowatlas spec --against

- openapi shop openapi.yaml: 4 operations declared, 4 in the code

1 error, 0 warnings, 1 info · 1 breaking by kind, 0 of them with no caller in this project

| level | change | operation | field | what | where | callers |
| --- | --- | --- | --- | --- | --- | --- |
| error | `method-removed` | `shop` `DELETE /products/{productId}` | — | the document declares this verb on the path; the code answers the path but not this verb | `document openapi.yaml:56` | — |
| info | `endpoint-added` | `shop` `GET /products/{id}/reviews` | — | the code answers this; the document does not say it | `code src/products/products.controller.ts:27` | — |

_not compared: descriptions, guards and formats (a document names them in words of its own)._

The complete report is `<out>/spec-against.json`.

