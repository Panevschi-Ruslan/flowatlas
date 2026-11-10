# angular-interceptor-host fixture

An Express API that mounts its routes under `/api`, and two Angular front ends
in repositories of their own whose services write bare paths. What sends them
to the API is a functional interceptor each registers with
`provideHttpClient(withInterceptors([...]))` (P280). Nothing in the
configuration says which host is whose: no `hosts`, no `apiTarget`.

| Service | Type | What it is |
|---|---|---|
| `api` | express | `GET /api/products`, `/api/products/featured`, `/api/products/:id`, `/api/sellers/:name`, `POST /api/sellers/:name/follow` |
| `web` | angular | `apiInterceptor` writes `` `https://catalog.example.test/api${req.url}` ``, behind `if (req.url.startsWith('/assets/')) return next(req)`; `authInterceptor` only sets a header |
| `admin` | angular | `baseInterceptor` writes `environment.apiUrl + req.url`; `src/environments/environment.ts` gives `apiUrl` the value `https://catalog.example.test/api` |

## Requests

| Where | Written | Recorded | Joins |
|---|---|---|---|
| `web` `catalog.service.ts:21` | `'/products' + (featured ? '/featured' : '')` | one request per branch: `https://catalog.example.test/api/products` and `.../api/products/featured`, host `catalog.example.test` | `GET /api/products` and `GET /api/products/featured`, `heuristic`, `unique-route` |
| `web` `catalog.service.ts:25` | `` `/products/${id}` `` | `.../api/products/:param` | `GET /api/products/:id`, `heuristic` |
| `web` `catalog.service.ts:29` | `'/sellers/' + name` | `.../api/sellers/:param` | `GET /api/sellers/:name`, `heuristic` |
| `web` `catalog.service.ts:33` | `'/sellers/' + name + '/follow'` | `.../api/sellers/:param/follow` | `POST /api/sellers/:name/follow`, `heuristic` |
| `web` `catalog.service.ts:38` | `'/assets/labels.json'` | `/assets/labels.json`: the guard sends it on as it is | nothing: `target-route-not-found` (a file the page serves, which no service here does) |
| `admin` `sellers.service.ts:16` | `'/sellers/' + name` | `${apiUrl}/sellers/:param` | `GET /api/sellers/:name`, `heuristic`, `unique-route`, under the path of the value the environment file gives `apiUrl` |

The host names no configured service, so each join is the one service serving
the address, a guess the edge says it is. Before P280 the `web` requests were
recorded at `/https:/catalog.example.test/api/...` (the literal base read as a
path) or not read at all (`+`, and the guard dropping the base from every
request), and `admin`'s `${apiUrl}/sellers/:param` matched no route.
