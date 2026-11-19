# cluster-port-joins fixture

Services a cluster's manifests route to, containers a `Makefile` or a shell
script starts, a workspace tool's serve target, and NestJS settings objects
handed in by their token (P257). Each says where a service is reached, and a
request is joined there with `meta.listensAt` saying how; a request on a
network to a port the service is not reached at there is a finding.

| Service | Type | Listens | Read from |
|---|---|---|---|
| `orders` | express | 3000, behind `orders:80` | `src/server.ts:10` `app.listen(3000)`; `k8s/orders.yaml` a `Deployment` naming `containerPort: 3000` `http`, a `Service` `orders` routing 80 to `targetPort: http` |
| `stock` | express | 4000 in its pods, behind `stock-api:8080` | `src/server.ts:10` `Number(process.env.PORT) \|\| 3000`; the project's `deploy/stock.yaml`: a `Service` `stock-api` in namespace `shop` routing 8080 to 4000, selecting a `StatefulSet` whose container is given `PORT: "4000"` |
| `notify` | express | 3000 | `src/server.ts:10`; its Helm chart's `Service` routes 80 to 8080, a port the code does not listen on (a note); the chart has no values file, so its templated port gives nothing and its labels' `include` names no helper (since P260 the chart is rendered; what it reads is the same) |
| `search` | express | 3000, published as 4010 | `Makefile` `docker run -p 4010:3000 --name search`, a command continued over three lines |
| `audit` | express | 3000 in its container, published as 4011 | `src/server.ts:10` `app.listen(process.env.PORT)`; `scripts/run.sh` `docker run -p 4011:3000 -e PORT=3000 --name audit` |
| `billing` | nestjs | 3012 [PORT] | `src/main.ts:10` `app.listen(config.port)`, `config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY)`, `registerAs('app', () => ({ port: Number(process.env.PORT) \|\| 3012 }))` |
| `ledger` | nestjs | 3013 [PORT] | `src/server.ts:12` `app.listen(this.config.port)`, `@Inject(appConfig.KEY) config: ConfigType<typeof appConfig>` |
| `shop` | nextjs | 4300 | `project.json:11`, the `@nx/next:server` target's `port`; the `@nx/js:node` target's `port` 9229 is the debugger's and is not read |
| `jobs` | express | 3009 | the requests |

## Requests (all from `jobs` `src/server.ts`)

| Line | Request | Joins | Before P257 |
|---|---|---|---|
| 7 | `http://orders/orders` | orders, `static` (the configured name), `listensAt: src/server.ts:10, behind orders:80 (k8s/orders.yaml)`, port 80 from the scheme | orders, no `listensAt` |
| 8 | `http://stock-api.shop.svc.cluster.local:8080/stock` | stock, `heuristic`, `… (PORT from deploy/stock.yaml (stock-api)), behind stock-api:8080 (deploy/stock.yaml)` | a third party |
| 9 | `http://notify/notices` | notify by its name, `static`; the note `published-port-unheard` at `charts/notify/templates/service.yaml:12` | notify, no row |
| 10 | `http://orders:3000/orders` | nothing: `network-port-unreachable`, the containers' port is reached only through `orders:80` | orders, `static` |
| 11 | `http://localhost:4010/search` | search, `heuristic`, `src/server.ts:10, published as 4010 by Makefile` | a third party |
| 12 | `http://search:4010/search` | nothing: `network-port-unreachable`, 4010 is published on the machine; on the network it is `search:3000` | search, `static` |
| 13 | `http://localhost:4011/events` | audit, `heuristic`, `… (PORT from scripts/run.sh (audit)), published as 4011 by scripts/run.sh` | a third party |
| 14 | `http://localhost:3012/invoices` | billing, `heuristic`, `src/main.ts:10 (PORT)` | a third party |
| 15 | `http://localhost:3013/entries` | ledger, `heuristic`, `src/server.ts:12 (PORT)` | a third party |
| 16 | `http://localhost:4300/api/cart` | shop, `static`, `project.json:11` | a third party |

`ledger`'s `@Inject(appConfig.KEY)` is also a token the injection reader does
not know (`di-token-unknown`), as any token built by a settings library is.

## Expected

```
calls out: 10 total, 8 linked, 2 noRoute (network-port-unreachable), 0 third party
rows: network-port-unreachable at server.ts:10 and :12; published-port-unheard at charts/notify/templates/service.yaml:12
```

Measured with the tool at the commit before P257 over the same tree:

```
calls out: 10 total, 4 linked (two of them requests that will not connect), 6 third party
```
