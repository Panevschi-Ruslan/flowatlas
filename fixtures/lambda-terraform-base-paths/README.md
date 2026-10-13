# lambda-terraform-base-paths

Two repositories: `catalogue` publishes two APIs on the library's own domain,
`api.library.example`, each under a base path; `kiosk` calls them at that
address (R174). The base path is part of the address a caller writes, so it is
part of each route's path, and the kiosk's requests join.

Type-checked, never executed or deployed.

| API | Mapped by | Route as declared | Route as read | Stages recorded |
|---|---|---|---|---|
| `library-catalogue`, REST | `aws_api_gateway_base_path_mapping`, `base_path = "v1"` | `GET /items/{itemId}` | `GET /v1/items/:param` | `live` |
| `library-holds`, HTTP | `aws_apigatewayv2_api_mapping`, `api_mapping_key = "holds"` | `POST /requests` | `POST /holds/requests` | `$default` |

The stage is recorded beside the route and not put in front of it: a caller
reaches a stage through its invoke URL, which already carries it.

`kiosk`'s functions are deployed with `LIBRARY_API_URL = "https://api.library.example"`,
and `catalogue` declares that setting under `baseUrlEnv`, so

- `check-item.ts`: `` fetch(`${process.env.LIBRARY_API_URL}/v1/items/${itemId}`) `` joins `GET /v1/items/:param`;
- `request-hold.ts`: `` fetch(`${process.env.LIBRARY_API_URL}/holds/requests`, { method: 'POST' }) `` joins `POST /holds/requests`.

`doctor` has nothing to say: no row.
