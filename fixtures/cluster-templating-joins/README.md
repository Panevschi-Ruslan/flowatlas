# cluster-templating-joins fixture

The deployment templating P263 left out, read as the tools that install the
manifests read it (P273): a helmfile kept in a folder that a pipeline names
with `-f`, layered over two `bases`, whose release `needs` another; a command
that keeps one release by name and the releases it needs
(`--include-needs`); and a kustomization whose deprecated `vars` give the pod
its port and the way in its host. Nothing in the configuration chooses an
environment: the pipeline does.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | 3000, behind `orders:8080` | `deploy/helmfile.d/10-shop.yaml.gotmpl`, which the workflow applies as `helmfile -f deploy/helmfile.d -e production -l name=orders --include-needs apply`; its first part layers `deploy/bases/environments.yaml` (production's values file `deploy/values/production.yaml`, written from the helmfile's folder as helmfile loads a base) and `deploy/bases/payments.yaml.gotmpl` under it, so `ordersPort` is 8080 |
| `payments` | express | 3002, behind `payments:8082` | the release `payments` the second base declares in the namespace `shop`; `orders` needs `shop/payments`, so `--include-needs` installs it with production's `paymentsPort` 8082 |
| `stock` | express | `PORT` 4100 from its config map, behind `shop-stock:8080` | `stock/deploy/base`: the vars `STOCK_PORT` and `STOCK_HOST` read `data.port` and `data.host` of the `ConfigMap` `stock-config`, substituted in the pod's `env` (and `args`) and the `Ingress` host once the overlay's `namePrefix: shop-` has run; the workflow applies `stock/deploy/overlays/production` |
| `jobs` | express | 3009 | the requests |

`orders` also needs `cache`, which no release of the helmfile (nor a base it
layers) is: helmfile refuses to apply the helmfile, and the finding
`release-need-undefined` says so at the release.

## Requests

| Where | Request | Joins | Before P273 |
|---|---|---|---|
| `jobs` `server.ts:7` | `http://orders:8080/orders` | orders, `listensAt: src/server.ts:10, behind orders:8080 (deploy/charts/orders/templates/service.yaml)` | orders by its host alone, no `listensAt`: a folder `-f` names was not read, so the chart was read with its own values (port 80) |
| `jobs` `server.ts:8` | `http://payments:8082/payments` | payments, behind `payments:8082` | payments by its host alone |
| `jobs` `server.ts:9` | `http://shop-stock:8080/stock` | stock, `PORT from deploy/base/stock.yaml (shop-stock)`, behind `shop-stock:8080` | stock, heuristic, no `listensAt`, and `published-port-unheard` (its code read on 4000) |
| `jobs` `server.ts:10` | `https://stock.example.test/stock` | stock `via: ingress`, `wayIn: ingress/shop-edge` | a third party: the host was `$(STOCK_HOST)` |

## Expected

```
calls out: 4 total, 4 linked
rows: release-need-undefined at orders deploy/helmfile.d/10-shop.yaml.gotmpl:7
```

Measured with the tool at the commit before P273 over the same tree:

```
calls out: 4 total, 3 linked, 1 third party
rows: manifest-unread (vars not substituted) at stock deploy/base/kustomization.yaml:3;
      published-port-unheard at stock deploy/base/stock.yaml:35
```
