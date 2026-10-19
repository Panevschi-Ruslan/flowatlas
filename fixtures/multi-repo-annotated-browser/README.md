# multi-repo-annotated-browser

A browser annotation that names its service (P127). An online bookshop: a
catalogue, an orders service that also answers `GET /items`, an Angular
storefront whose `apiUrl` names the orders service, and a React back office.
No browser address is readable; every request is an annotation.

| Annotation | Where | Joined to |
|---|---|---|
| `@flowatlas-calls catalog GET /items` | `storefront` `ShopClient.items` | `catalog-api` `GET /items`, by the alias `catalog`, ahead of `apiTarget` |
| `@flowatlas-calls GET /orders` | `storefront` `ShopClient.orders` | `orders` `GET /orders`, through `apiTarget` as before |
| `@flowatlas-calls catalogue GET /items` | `storefront` `ShopClient.misspelt` | nothing: a `marker-service-unknown` row naming the aliases |
| `@flowatlas-calls catalog-api POST /items` | `admin` `addItem` | `catalog-api` `POST /items`, by name |

`orders`' `GET /items` is called by nothing: the one request for `/items`
from the storefront says it is the catalogue's.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/multi-repo-annotated-browser/flowatlas.config.json
```
