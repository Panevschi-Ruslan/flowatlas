# cluster-templating-needs fixture

The deployment templating P295 left open, read as the tools that install the
manifests read it (P299): a kustomization whose transformers come from a
folder that is itself a kustomization, built before they run (its patch
changes the prefix its `PrefixTransformer` writes), one of them a
`ValueAddTransformer` writing the port the pod listens on; and a helmfile run
with a selector and `--include-needs`, whose kept release needs a release of
another sub-helmfile and a chart repository's chart. What stays unread by
design says why: the chart a repository holds is fetched when helmfile runs.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | `PORT` 4100, behind `shop-orders:8080` | `orders/deploy/kustomization.yaml`, which the workflow applies; it lists the folder `transformers/`, a kustomization whose patch turns the `PrefixTransformer`'s `draft-` into `shop-`; `labels.yaml` writes `app: orders` into the service object's selector and the pod template; `port.yaml` is a `ValueAddTransformer` writing `4100` as the value of the pod's `PORT` |
| `stock` | express | 3001, behind `stock:8443` | the release `stock` of `deploy/apps/stock.yaml`, labelled `tier: data`, its values giving port 8443 (the chart's own say 80); the workflow keeps `tier=edge` with `--include-needs`, and `payments` (another sub-helmfile) needs `shop/stock` |
| `payments` | express | 3002, behind `payments:8082` | the release `payments` of `deploy/apps/payments.yaml`, `tier: edge` |
| `jobs` | express | 3009 | the requests |

`payments` also needs `shop/cache`, whose chart is `charts-example/cache`,
of the chart repository `deploy/apps/stock.yaml` declares: a
`manifest-unread` row says it is fetched when helmfile runs and not read.
`reports`, of the same repository, is kept by nothing and is not said.

## Requests

| Where | Request | Joins | Before P299 |
|---|---|---|---|
| `jobs` `server.ts:7` | `http://shop-orders:8080/orders` | orders, `listensAt` on 4100 behind `shop-orders:8080` | a third party (`external_api:shop-orders:8080`): the folder's configurations were read as written and the `PrefixTransformer` and `ValueAddTransformer` were rows, so the service object was `orders`, and `published-port-unheard` (its code read on 3000) |
| `jobs` `server.ts:8` | `http://stock:8443/stock` | stock, behind `stock:8443` | stock by its host alone, no `listensAt`: a need was kept within its own sub-helmfile only, so the release was not installed and the chart was read with its own values (port 80) |
| `jobs` `server.ts:9` | `http://payments:8082/payments` | payments, behind `payments:8082` | the same join |

## Expected

```
calls out: 3 total, 3 linked
rows: manifest-unread (chart of a repository) at payments deploy/apps/stock.yaml:14
```

Measured with the tool at the commit before P299 over the same tree:

```
calls out: 3 total, 2 linked, 1 third party
rows: published-port-unheard at orders deploy/orders.yaml:20;
      manifest-unread (ValueAddTransformer) at orders deploy/transformers/port.yaml:1;
      manifest-unread (PrefixTransformer) at orders deploy/transformers/prefix.yaml:1
```
