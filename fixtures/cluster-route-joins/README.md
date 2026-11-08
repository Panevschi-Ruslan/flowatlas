# cluster-route-joins fixture

Every way a cluster routes a request, read the way the tools that apply the
manifests build them (P260): a chart rendered with its values and the values
its install command gives, a kustomization built over its base with its
patches (the overlay `settingFiles.environment` names), the ways in from
outside the cluster (`Ingress`, `HTTPRoute`), a node port, and the ports a
developer's `kubectl port-forward` makes this machine reach.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | 3000, behind `orders:8080`, at node port 30080 | `charts/orders`: `values.yaml` (port 80, `ClusterIP`) under `values-production.yaml` (port 8080, `NodePort`, `nodePort: 30080`), the values file the `Makefile`'s `helm upgrade --install orders ./charts/orders -f … --namespace shop` gives; the release `orders` makes the `orders.fullname` helper `orders`; `range` writes the pods' environment; the `if .Capabilities…` around `apiVersion` goes both ways alike, so it is read |
| `stock` | express | 4000 in its pods (`PORT`), behind `stock:8080` | `deploy/base` under the `production` overlay the environment names: a JSON 6902 patch makes the container's port 4000 and the service's 8080, a strategic merge patch (`env.yaml`) gives `PORT: "4000"`, `images` renames the image; the `staging` overlay is not read |
| `billing` | express | 3004, behind `billing:80` | `k8s/base`; its `blue` and `green` overlays route 8081 and 8082, and nothing chooses, so the base is read alone (`manifest-overlay-unchosen`); `green`'s `copy` operation is not applied (`manifest-unread`) |
| `catalog` | express | 3003, behind `catalog:80` | `k8s/catalog.yaml` |
| `web` | react | nothing its code says | `k8s/web.yaml` routes `web:80` to its containers' 80 (a note: nothing in its code listens); the way in serves it at `shop.example.test` |
| `jobs` | express | 3009 | the requests |

The project's own `deploy/ingress.yaml` holds two `Ingress` objects for
`shop.example.test`: `shop`, whose `use-regex` and `rewrite-target: /$2`
annotations make `/catalog(/|$)(.*)` a pattern rewritten to its second group,
and `shop-plain`, with `/orders` (`Prefix`, to `orders`'s port named `web`),
`/health` (`Exact`, to `stock:8080`) and `/` (to `web`). `deploy/gateway.yaml`
holds a `Gateway` listening for `api.example.test` and an `HTTPRoute` with no
hostnames of its own, so it takes the gateway's, sending `/inventory` to
`stock:8080` with its prefix replaced by `/stock`. The project's `Makefile`
forwards `svc/catalog 8081:80` and `deploy/stock 4001:4000`.

## Requests

| Where | Request | Joins | Before P260 |
|---|---|---|---|
| `jobs` `server.ts:7` | `https://shop.example.test/orders` | orders `GET /orders`, `via: ingress`, `wayIn: ingress/shop-plain`, `proxiedBy: deploy/ingress.yaml:32`, `listensAt: src/server.ts:14, behind orders:8080 (charts/orders/templates/service.yaml)` | a third party |
| `jobs` `server.ts:8` | `https://shop.example.test/catalog/products` | catalog `GET /products`, `proxiedAs: /products` (the pattern is tried before `/`) | a third party |
| `jobs` `server.ts:9` | `https://shop.example.test/health` | stock `GET /health` by the `Exact` path, `PORT from deploy/overlays/production/env.yaml (stock)` | a third party |
| `jobs` `server.ts:10` | `https://api.example.test/inventory/ABC-1` | stock `GET /stock/:param`, `wayIn: http-route/inventory`, `proxiedAs: /stock/ABC-1` | a third party |
| `jobs` `server.ts:11` | `http://localhost:30080/orders` | orders, `listensAt: …, at node port 30080 of orders (…/service.yaml)` | a third party |
| `jobs` `server.ts:12` | `http://localhost:8081/products` | catalog, `…, forwarded from 8081 to svc/catalog by Makefile` | a third party |
| `jobs` `server.ts:13` | `http://localhost:4001/stock` | stock, `… (PORT from deploy/overlays/production/env.yaml (deploy/stock)), forwarded from 4001 to deploy/stock by Makefile` | a third party |
| `jobs` `server.ts:14` | `http://stock.shop:8080/stock` | stock, `…, behind stock:8080 (deploy/base/stock.yaml)` | a third party |
| `jobs` `server.ts:15` | `http://billing/invoices` | billing, `static`, `behind billing:80 (k8s/base/billing.yaml)` | the same |
| `jobs` `server.ts:16` | `http://orders:8080/orders` | orders, `static`, `behind orders:8080` | orders by its name, no `listensAt` |
| `web` `Shop.tsx:3` | `/orders` | orders through the way in that serves web, `via: ingress` | orders by its route alone (`unique-route`) |
| `web` `Shop.tsx:4` | `/catalog/products` | catalog `GET /products` through the way in | `target-route-not-found` |

## Expected

```
calls out: 10 total, 10 linked, 0 third party
ui calls: 2 total, 2 joined (via: ingress)
rows: manifest-overlay-unchosen at billing k8s/overlays/blue/kustomization.yaml:1;
      manifest-unread at billing k8s/overlays/green/kustomization.yaml:3;
      published-port-unheard at web k8s/web.yaml:7
```

Measured with the tool at the commit before P260 over the same tree:

```
calls out: 10 total, 2 linked, 8 third party
ui calls: 2 total, 1 joined (by its route alone), 1 target-route-not-found
```
