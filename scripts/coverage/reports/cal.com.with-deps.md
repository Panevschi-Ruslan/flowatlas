# cal.com - dependencies installed with `--ignore-scripts`

Next.js in a monorepo, tRPC, wrapped Prisma.

|  |  |
|---|---|
| repository | `calcom/cal.com` |
| commit | `54343aa685ae8f33159d2f485ec4a57bad5c574a` |
| read | `apps/web` |
| read by | web (`nextjs`) |
| source files counted | 839 |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Dependencies

| where | manager | exit | note |
|---|---|---|---|
| `.` | yarn-berry | 0 | installed |

## Ways in

| kind | entry points |
|---|---|
| http | 84 |
| rpc | 13 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 84 |  |
| declarations with a body attached | 50 | 50 of 79 |
| …whose body reaches anything | 47 | 47 of 79 |
| …behind middleware or a guard | 0 | 0 of 79 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 32 | 0 |
| requests between services | 38 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 73 | 73 of 80 |
| …that name a table | 4 | 4 of 73 |
| tables | 1 | no denominator: the rule has no probe for it |
| components | 773 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 775 | not counted by the rule |

## What it could not read

149 places somebody could act on, 50 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 7 |  |
| call-dynamic-receiver | info | 50 |  |
| db-layer-unread | action | 6 |  |
| db-receiver-name-only | action | 69 |  |
| dynamic-http-url | action | 6 |  |
| route-handler-unread | action | 31 |  |
| server-action-unread | action | 2 |  |
| target-route-not-found | action | 23 |  |
| unknown-base-url-env | action | 1 |  |
| unknown-db-package | action | 4 |  |

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 44 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 35 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 80 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 0 |

| family | sites |
|---|---|
| ways in over HTTP | 79 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 80 |
| tables or models declared (an upper bound) | 0 |

## Cost

Wall clock 5 to 15 s, peak resident memory 2 to 3 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
