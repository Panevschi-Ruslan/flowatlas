# cluster-install-joins fixture

Every way a cluster's manifests are installed, read as the tools that install
them do (P263): a `helmfile` and the environment a pipeline runs it with, an
umbrella chart rendering the charts it depends on inside its own release, a
kustomization that generates its config map, replaces a port with it and
inflates a chart, an `Ingress` rule with no host, and the commands of a GitHub
workflow and a GitLab job. Nothing in the configuration chooses an environment:
the pipelines do.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | 3000, behind `shop-orders:8080` | `deploy/helmfile.yaml` installs `deploy/charts/shop` as the release `shop` in `staging` and `production`; the workflow runs `helmfile -f deploy/helmfile.yaml -e production apply`, so production's `values/shop-production.yaml` gives the `orders:` subtree port 8080; `shop` depends on `file://../orders`, rendered inside the release `shop`, and on the library chart `common`, whose `common.fullname` helper names the object `shop-orders` |
| `catalog` | express | 3003, behind `shop-catalog:8083` and `catalog-preview-catalog:9093` | the same umbrella chart, its port set from the production environment's values (`set: catalog.service.port`); and the GitLab job's `helm upgrade --install catalog-preview deploy/charts/catalog --set service.port=9093`, which installs the dependency on its own too |
| `stock` | express | `PORT` 4100 from its config map, behind `stock:8080` and `stock-admin:9090` | `stock/deploy/base`: a `configMapGenerator` from `stock.env` (`PORT=4100`), read by the pods' `envFrom`, and a replacement writing it into the service object's `targetPort`; the workflow's `kubectl apply -k stock/deploy/overlays/production` chooses `production` over `staging` (port 8080), which also inflates `charts/stock-admin` with `valuesInline: { port: 9090 }` |
| `web` | react | nothing its code says | `web/k8s/web.yaml`; the `Ingress` rule with no host serves it at `/` |
| `jobs` | express | 3009 | the requests |

`deploy/ingress.yaml` holds one `Ingress`, `edge`: a rule for
`admin.example.test` sending `/orders` to `shop-orders:8080`, and a rule with no
host sending `/orders`, `/catalog` and `/` to `shop-orders`, `shop-catalog` and
`web`. The chart `metrics` the umbrella chart depends on has `condition:
metrics.enabled`, false in its values, and is not rendered. The GitLab job
`smoke` forwards `svc/shop-orders 8085:8080`.

## Requests

| Where | Request | Joins | Before P263 |
|---|---|---|---|
| `jobs` `server.ts:7` | `http://shop-orders:8080/orders` | orders, `listensAt: src/server.ts:10, behind shop-orders:8080 (deploy/charts/orders/templates/service.yaml)` | a third party |
| `jobs` `server.ts:8` | `http://shop-catalog:8083/catalog/products` | catalog, behind `shop-catalog:8083` | a third party |
| `jobs` `server.ts:9` | `http://stock:8080/stock` | stock, `PORT from deploy/base/stock.env (stock)`, behind `stock:8080` | stock by its name, no `listensAt` |
| `jobs` `server.ts:10` | `http://stock-admin:9090/stock` | stock, behind `stock-admin:9090` (the inflated chart) | stock by the file, no `listensAt`, and a `published-port-unheard` note |
| `jobs` `server.ts:11` | `http://catalog-preview-catalog:9093/catalog/products` | catalog, behind the preview release | a third party |
| `jobs` `server.ts:12` | `http://localhost:8085/orders` | orders, `forwarded from 8085 to svc/shop-orders by .gitlab-ci.yml` | a third party |
| `jobs` `server.ts:13` | `https://admin.example.test/orders` | orders `via: ingress`, `wayIn: ingress/edge`, `proxiedBy: deploy/ingress.yaml:11` | a third party |
| `jobs` `server.ts:14` | `https://other.example.test/catalog/products` | a third party: a rule with no host is not taken to answer a host nothing names | the same |
| `web` `Shop.tsx:3` | `/orders` | orders through the rule with no host that serves web, `via: ingress`, `proxiedBy: deploy/ingress.yaml:20` | orders by its route alone (`unique-route`) |
| `web` `Shop.tsx:4` | `/catalog/products` | catalog through the same rule, `proxiedBy: deploy/ingress.yaml:27` | catalog by its route alone |

## Expected

```
calls out: 8 total, 7 linked, 1 third party
ui calls: 2 total, 2 joined (via: ingress)
rows: published-port-unheard at web k8s/web.yaml:7 (as P260)
```

Measured with the tool at the commit before P263 over the same tree:

```
calls out: 8 total, 2 linked, 6 third party
ui calls: 2 total, 2 joined by their routes alone
rows: manifest-overlay-unchosen at stock deploy/overlays/production/kustomization.yaml:1;
      published-port-unheard at stock (stock-admin routed to 4100, the code read on 4000) and at web
```
