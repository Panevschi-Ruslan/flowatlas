# medusa - a fresh clone, no dependencies installed - what a stranger gets

a file-system router with no reader.

|  |  |
|---|---|
| repository | `medusajs/medusa` |
| commit | `62a520014886df3838aa9f31f2990afecae38333` |
| read | `packages/medusa` |
| read by | medusa (`express`) |
| source files counted | 778 |
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
| declarations with a body attached | 0 | 0 of 488 |
| …whose body reaches anything | 0 | 0 of 488 |
| …behind middleware or a guard | 0 | 0 of 488 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 0 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 3 | 3 of 6 |
| …that name a table | 0 | 0 of 3 |
| tables | 0 | nothing of this kind here |
| components | 0 | nothing of this kind here |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

11 places somebody could act on, 58 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 57 |  |
| db-receiver-name-only | action | 3 |  |
| entry-http-types-unmatched | info | 1 |  |
| type-unresolved | action | 8 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 1 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 487 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 6 |
| `model-declaration` | a table or model declared as a class or a schema | 0 |

| family | sites |
|---|---|
| ways in over HTTP | 488 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 6 |
| tables or models declared (an upper bound) | 0 |

## Cost

Wall clock under 5 s, peak resident memory under 0.5 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
