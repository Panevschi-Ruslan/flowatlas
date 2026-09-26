# outline - a fresh clone, no dependencies installed - what a stranger gets

Koa + React + socket.io + Sequelize in one repository.

|  |  |
|---|---|
| repository | `outline/outline` |
| commit | `aacc98475d1f5bb0f192665b539db00126d491ee` |
| read | `.` |
| read by | outline (`koa`, set; `link` guessed `react`) |
| source files counted | 2188 |
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
| declarations with a body attached | 0 | 0 of 266 |
| …whose body reaches anything | 0 | 0 of 266 |
| …behind middleware or a guard | 0 | 0 of 266 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 2 | 0 |
| requests between services | 32 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 77 | no denominator: the rule has no probe for it |
| …that name a table | 0 | 0 of 77 |
| tables | 0 | 0 of 103 |
| components | 644 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 777 | not counted by the rule |

## What it could not read

832 places somebody could act on, 3457 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 2 |  |
| call-dynamic-receiver | info | 2716 |  |
| db-layer-unread | action | 4 |  |
| db-receiver-name-only | action | 77 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 24 |  |
| entry-http-types-unmatched | info | 1 |  |
| type-depth-exceeded | info | 571 |  |
| type-generic-uninstantiated | info | 169 |  |
| type-unresolved | action | 722 |  |
| unknown-base-url-env | action | 1 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 266 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 103 |

| family | sites |
|---|---|
| ways in over HTTP | 266 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 103 |

## Cost

Wall clock 5 to 15 s, peak resident memory 1 to 2 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
