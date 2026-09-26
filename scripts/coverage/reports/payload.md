# payload - a fresh clone, no dependencies installed - what a stranger gets

Next.js, nested application roots, a heap the default limit does not hold.

|  |  |
|---|---|
| repository | `payloadcms/payload` |
| commit | `124b55a8747d9b45db0af30aad337569d37a9b3e` |
| read | `.` |
| read by | payload-monorepo (`nextjs`) |
| source files counted | 4459 |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 17 |
| rpc | 9 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 17 |  |
| declarations with a body attached | 17 | 17 of 128 |
| …whose body reaches anything | 3 | 3 of 128 |
| …behind middleware or a guard | 0 | 0 of 128 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 159 | 0 |
| requests between services | 161 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 313 | no denominator: the rule has no probe for it |
| …that name a table | 0 | 0 of 313 |
| tables | 0 | 0 of 2 |
| components | 1915 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 897 | not counted by the rule |

## What it could not read

916 places somebody could act on, 541 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 74 |  |
| call-dynamic-receiver | info | 534 |  |
| db-receiver-name-only | action | 313 |  |
| dynamic-config-key | action | 7 |  |
| dynamic-http-url | action | 74 |  |
| route-handler-unread | action | 259 |  |
| target-route-not-found | action | 68 |  |
| type-depth-exceeded | info | 1 |  |
| type-generic-uninstantiated | info | 6 |  |
| type-unresolved | action | 98 |  |
| unknown-base-url-env | action | 23 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 128 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 2 |

| family | sites |
|---|---|
| ways in over HTTP | 128 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 2 |

## Cost

Wall clock 5 to 15 s, peak resident memory 2 to 3 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
