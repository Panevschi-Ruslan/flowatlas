# excalidraw - dependencies installed with `--ignore-scripts`

a repository with no server.

|  |  |
|---|---|
| repository | `excalidraw/excalidraw` |
| commit | `c10499eebb6267f24c056a03c5daf436aada0446` |
| read | `.` |
| read by | excalidraw-monorepo (`nextjs`) |
| source files counted | 519 |
| extent counted over | `.` alone (not a member of any workspace here) |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Dependencies

| where | manager | exit | note |
|---|---|---|---|
| `.` | yarn | 0 | installed |

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
| addresses claimed by more than one declaration | 0 | a collision, or one service holding two applications |
| declarations with a body attached | 0 | nothing of this kind here |
| …whose body reaches anything | 0 | nothing of this kind here |
| …behind middleware or a guard | 0 | nothing of this kind here |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

No addresses.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 12 | 0 |
| requests between services | 11 | 0 |
| channels | 5 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | nothing of this kind here |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | nothing of this kind here |
| components | 396 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 425 | not counted by the rule |

## What it could not read

27 places somebody could act on, 311 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 7 |  |
| call-dynamic-receiver | info | 224 |  |
| channel-dynamic | action | 1 |  |
| consumer-handler-unresolved | action | 2 |  |
| db-layer-unread | action | 5 |  |
| dynamic-http-url | action | 6 |  |
| target-route-not-found | action | 3 |  |
| type-depth-exceeded | info | 39 |  |
| type-generic-uninstantiated | info | 48 |  |
| unknown-base-url-env | action | 3 |  |

## Files with sites and no output

None. Every file the counting rule found a declaration site in yielded a node of
that family, or a row naming the file.

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

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 15 to 60 s, peak resident memory 1 to 2 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
