# peertube - a fresh clone, no dependencies installed - what a stranger gets

Angular and Express in one repository.

|  |  |
|---|---|
| repository | `Chocobozzz/PeerTube` |
| commit | `faa76bad2c1969a088ef1df38dc666dfe7259b5c` |
| read | `server`, `client` |
| read by | peertube-client (`angular`), peertube-server (`express`) |
| source files counted | 2136 |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| none | 0 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 0 |  |
| declarations with a body attached | 0 | 0 of 343 |
| …whose body reaches anything | 0 | 0 of 343 |
| …behind middleware or a guard | 0 | 0 of 343 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 0 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 12 | no denominator: the rule has no probe for it |
| …that name a table | 3 | 3 of 12 |
| tables | 1 | 1 of 85 |
| components | 330 | 330 of 330 |
| clicks | 307 | 307 of 307 |
| every other binding a template makes | 1006 | not counted by the rule |

## What it could not read

1465 places somebody could act on, 2938 the tool
reports as a limit of static reading, and 234 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 2417 |  |
| db-layer-unread | action | 2 |  |
| db-receiver-name-only | action | 9 |  |
| dynamic-config-key | action | 1 |  |
| handler-not-a-method | nothing | 234 |  |
| handler-not-found | action | 35 |  |
| inject-token-unresolved | info | 284 |  |
| route-link-dynamic | info | 35 |  |
| route-screen-unread | info | 18 |  |
| route-target-unresolved | action | 117 |  |
| type-depth-exceeded | info | 54 |  |
| type-generic-uninstantiated | info | 130 |  |
| type-unresolved | action | 1298 |  |
| unknown-db-package | action | 3 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 343 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 330 |
| `template-click-binding` | a click bound in a template | 307 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 85 |

| family | sites |
|---|---|
| ways in over HTTP | 343 |
| screens | 330 |
| things a person can click | 307 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 85 |

## Cost

Wall clock 5 to 15 s, peak resident memory 0.5 to 1 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
