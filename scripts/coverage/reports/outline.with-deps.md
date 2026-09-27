# outline - dependencies installed with `--ignore-scripts`

Koa + React + socket.io + Sequelize in one repository.

|  |  |
|---|---|
| repository | `outline/outline` |
| commit | `aacc98475d1f5bb0f192665b539db00126d491ee` |
| read | `.` |
| read by | outline (`koa`) |
| source files counted | 2188 |
| extent counted over | `.` alone (not a member of any workspace here) |
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
| http | 261 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 261 |  |
| addresses claimed by more than one declaration | 0 | a collision, or one service holding two applications |
| declarations with a body attached | 257 | 257 of 266 |
| …whose body reaches anything | 249 | 249 of 266 |
| …behind middleware or a guard | 256 | 256 of 266 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 196 |
| `/oauth` | 7 |

58 more at 47 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 30 | 19 |
| requests between services | 32 | 0 |
| channels | 33 | 1 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 1197 | no denominator: the rule has no probe for it |
| …that name a table | 1165 | 1165 of 1197 |
| tables | 41 | 41 of 103 |
| components | 644 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 777 | not counted by the rule |

## What it could not read

160 places somebody could act on, 2000 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 4 |  |
| call-dynamic-receiver | info | 344 |  |
| channel-const-unresolved | action | 12 |  |
| channel-dynamic | action | 9 |  |
| consumer-handler-unresolved | action | 2 |  |
| db-layer-unread | action | 6 |  |
| db-receiver-name-only | action | 11 |  |
| dynamic-cache-key | action | 40 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 24 |  |
| dynamic-table-name | action | 32 |  |
| route-handler-anonymous | info | 4 |  |
| route-path-dynamic | action | 5 |  |
| target-route-not-found | action | 7 |  |
| type-depth-exceeded | info | 1209 |  |
| type-generic-uninstantiated | info | 443 |  |
| type-unresolved | action | 5 |  |
| unknown-base-url-env | action | 1 |  |

## Files with sites and no output

None. Every file the counting rule found a declaration site in yielded a node of
that family, or a row naming the file.

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

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 15 to 60 s, peak resident memory 2 to 3 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
