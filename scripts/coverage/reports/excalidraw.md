# excalidraw - a fresh clone, no dependencies installed - what a stranger gets

a repository with no server.

|  |  |
|---|---|
| repository | `excalidraw/excalidraw` |
| commit | `c10499eebb6267f24c056a03c5daf436aada0446` |
| read | `.` |
| read by | excalidraw-monorepo (`nextjs`) |
| source files counted | 519 |
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
| declarations with a body attached | 0 | nothing of this kind here |
| …whose body reaches anything | 0 | nothing of this kind here |
| …behind middleware or a guard | 0 | nothing of this kind here |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 12 | 0 |
| requests between services | 11 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 80 | no denominator: the rule has no probe for it |
| …that name a table | 0 | 0 of 80 |
| tables | 0 | nothing of this kind here |
| components | 396 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 425 | not counted by the rule |

## What it could not read

119 places somebody could act on, 724 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 7 |  |
| call-dynamic-receiver | info | 638 |  |
| db-receiver-name-only | action | 80 |  |
| dynamic-http-url | action | 6 |  |
| target-route-not-found | action | 3 |  |
| type-depth-exceeded | info | 39 |  |
| type-generic-uninstantiated | info | 47 |  |
| type-unresolved | action | 20 |  |
| unknown-base-url-env | action | 3 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
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
| ways in over HTTP | 0 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 0 |

## Cost

Wall clock 5 to 15 s, peak resident memory 0.5 to 1 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
