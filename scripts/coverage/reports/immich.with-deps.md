# immich - dependencies installed with `--ignore-scripts`

NestJS at scale, Kysely, an in-house bus.

|  |  |
|---|---|
| repository | `immich-app/immich` |
| commit | `f8f4051a24fffa49accb96bd4f107f8b8d5915e9` |
| read | `server` |
| read by | immich (`nestjs`) |
| source files counted | 454 |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Dependencies

| where | manager | exit | note |
|---|---|---|---|
| `.` | pnpm | 0 | installed |

## Ways in

| kind | entry points |
|---|---|
| http | 292 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 292 |  |
| declarations with a body attached | 303 | 303 of 303 |
| …whose body reaches anything | 300 | 300 of 303 |
| …behind middleware or a guard | 303 | 303 of 303 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 6 | 0 |
| channels | 3 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 1560 | 1560 of 579 |
| …that name a table | 407 | 407 of 1560 |
| tables | 2 | 2 of 68 |
| components | 9 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

1612 places somebody could act on, 285 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 38 |  |
| call-module-ref | action | 5 |  |
| channel-const-unresolved | action | 5 |  |
| channel-dynamic | action | 2 |  |
| consumer-handler-unresolved | action | 3 |  |
| db-layer-unread | action | 2 |  |
| db-receiver-name-only | action | 1153 |  |
| di-token-unknown | action | 1 |  |
| di-type-unresolved | action | 1 |  |
| dynamic-cache-key | action | 6 |  |
| dynamic-http-url | action | 6 |  |
| module-import-dynamic | action | 7 |  |
| type-depth-exceeded | info | 206 |  |
| type-generic-uninstantiated | info | 41 |  |
| type-unresolved | action | 14 |  |
| unknown-db-package | action | 407 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 303 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 579 |
| `model-declaration` | a table or model declared as a class or a schema | 68 |

| family | sites |
|---|---|
| ways in over HTTP | 303 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 579 |
| tables or models declared (an upper bound) | 68 |

## Cost

Wall clock 5 to 15 s, peak resident memory 1 to 2 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
