# novu - a fresh clone, no dependencies installed - what a stranger gets

NestJS, versioning, deep-subpath imports.

|  |  |
|---|---|
| repository | `novuhq/novu` |
| commit | `85ae4fdfcd12b1189633b0bc369c23a76883d76f` |
| read | `apps/api` |
| read by | api-service (`nestjs`) |
| source files counted | 1872 |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 427 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 427 |  |
| declarations with a body attached | 450 | 450 of 456 |
| …whose body reaches anything | 403 | 403 of 456 |
| …behind middleware or a guard | 358 | 358 of 456 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 8 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 1281 | no denominator: the rule has no probe for it |
| …that name a table | 0 | 0 of 1281 |
| tables | 0 | nothing of this kind here |
| components | 0 | nothing of this kind here |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

5535 places somebody could act on, 2288 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 1927 |  |
| db-receiver-name-only | action | 1281 |  |
| di-token-ambiguous | action | 2 |  |
| di-token-unknown | action | 13 |  |
| di-type-unresolved | action | 1412 |  |
| dynamic-config-key | action | 4 |  |
| dynamic-http-url | action | 2 |  |
| entry-http-types-unmatched | info | 1 |  |
| global-wrapper-dynamic | action | 98 |  |
| module-import-dynamic | action | 15 |  |
| route-path-dynamic | action | 2 |  |
| type-depth-exceeded | info | 18 |  |
| type-generic-uninstantiated | info | 342 |  |
| type-unresolved | action | 2706 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 456 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 0 |

| family | sites |
|---|---|
| ways in over HTTP | 456 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 0 |

## Cost

Wall clock 5 to 15 s, peak resident memory 0.5 to 1 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
