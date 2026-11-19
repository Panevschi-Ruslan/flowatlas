# cluster-transformer-joins fixture

The deployment templating P289 left open, read as the tools that install the
manifests read it (P295): a kustomization whose name, labels and port come
from the transformer and generator files it lists rather than from its own
fields; a helmfile whose release needs a release another of its
sub-helmfiles declares; and a chart whose port comes up through
`import-values` from a dependency of its dependency. What stays unread by
design says why: an exec plugin, a release's hook, and a dependency only a
chart repository has.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | `PORT` 4100 from its generated config map, behind `shop-orders:8080` | `orders/deploy/kustomization.yaml`, which the workflow applies: `generators/settings.yaml` is a built-in `ConfigMapGenerator` (`PORT=4100`) the pod takes whole (`envFrom`); `transformers/prefix.yaml` a `PrefixSuffixTransformer` naming everything `shop-…`, the config map the pod names included; `transformers/labels.yaml` a `LabelTransformer` writing `app: orders` into the service object's selector and the pod template, which the file leaves without either |
| `stock` | express | 3001, behind `stock:8443` | the release `stock` of `deploy/apps/stock.yaml`, a sub-helmfile of `deploy/helmfile.yaml`; its chart imports `service` from its dependency `api`, which first imports `exports.ports` (`port: 8443`) from its own dependency `ports` into `service` |
| `payments` | express | 3002, behind `payments:8082` | the release `payments` of `deploy/apps/payments.yaml`, which needs `shop/stock`, a release of the other sub-helmfile: installed after it |
| `jobs` | express | 3009 | the requests |

`transformers/mesh.yaml` configures `SidecarInjector`, an exec plugin
kustomize runs: a `manifest-unread` row says it is not read. The release
`stock` runs a `presync` hook, a program helmfile runs and nothing reads: a
row. The chart `stock` also depends on `queue` from a chart repository,
which nothing has fetched into `charts/`: a row, as no repository is read.

## Requests

| Where | Request | Joins | Before P295 |
|---|---|---|---|
| `jobs` `server.ts:7` | `http://shop-orders:8080/orders` | orders, `listensAt: src/server.ts:10 (PORT from deploy/generators/settings.yaml (shop-orders)), behind shop-orders:8080 (deploy/orders.yaml)` | a third party (`external_api:shop-orders:8080`): the transformer files were not read, so the service object was `orders`, and `published-port-unheard` (its code read on 3000) |
| `jobs` `server.ts:8` | `http://stock:8443/stock` | stock, behind `stock:8443` | stock by its host alone, no `listensAt`: `api` handed up its `service` before `ports` had imported into it, so the port was the chart's default 80 |
| `jobs` `server.ts:9` | `http://payments:8082/payments` | payments, behind `payments:8082` | the same join, with `release-need-undefined` at `deploy/apps/payments.yaml:2`: a need was asked of its own sub-helmfile only |

## Expected

```
calls out: 3 total, 3 linked
rows: manifest-unread (exec plugin) at orders deploy/transformers/mesh.yaml:1;
      manifest-unread (hook) at stock deploy/apps/stock.yaml:2;
      manifest-unread (chart only a repository has) at stock deploy/charts/stock/Chart.yaml:11
```

Measured with the tool at the commit before P295 over the same tree:

```
calls out: 3 total, 2 linked, 1 third party
rows: published-port-unheard at orders deploy/orders.yaml:21;
      release-need-undefined at payments deploy/apps/payments.yaml:2
```
