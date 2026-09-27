# novu - a fresh clone, no dependencies installed - what a stranger gets

NestJS, versioning, deep-subpath imports.

|  |  |
|---|---|
| repository | `novuhq/novu` |
| commit | `85ae4fdfcd12b1189633b0bc369c23a76883d76f` |
| read | `apps/api` |
| read by | api-service (`nestjs`) |
| source files counted | 4984 |
| extent counted over | `apps/api` plus 23 declared package(s): `enterprise/packages/ai`, `enterprise/packages/api`, `enterprise/packages/auth`, `enterprise/packages/billing`, `enterprise/packages/shared-services`, `enterprise/packages/translation`, `libs/application-generic`, `libs/dal`, `libs/internal-sdk`, `libs/maily-render`, `libs/maily-tsconfig`, `libs/notifications`, `libs/testing`, `packages/agent-event-protocol`, `packages/chat-adapter-email`, `packages/chat-adapter-photon-imessage`, `packages/chat-adapter-sendblue`, `packages/chat-adapter-web-chat`, `packages/framework`, `packages/novu`, `packages/providers`, `packages/shared`, `packages/stateless` |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 456 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 456 |  |
| addresses claimed by more than one declaration | 3 | a collision, or one service holding two applications |
| declarations with a body attached | 459 | 459 of 464 |
| …whose body reaches anything | 407 | 407 of 464 |
| …behind middleware or a guard | 363 | 363 of 464 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/${…}v1` | 386 |
| `/${…}v2` | 69 |

1 more at 1 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 30 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | nothing of this kind here |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | nothing of this kind here |
| components | 0 | nothing of this kind here |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

7276 places somebody could act on, 4014 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 3532 |  |
| db-layer-unread | action | 5 |  |
| db-receiver-name-only | action | 1618 |  |
| di-token-ambiguous | action | 3 |  |
| di-token-unknown | action | 24 |  |
| di-type-unresolved | action | 1580 |  |
| dynamic-config-key | action | 22 |  |
| dynamic-http-url | action | 8 |  |
| entry-http-types-unmatched | info | 1 |  |
| global-wrapper-dynamic | action | 98 |  |
| module-import-dynamic | action | 15 |  |
| route-path-dynamic | action | 1 |  |
| type-depth-exceeded | info | 46 |  |
| type-generic-uninstantiated | info | 435 |  |
| type-unresolved | action | 3901 |  |
| unknown-base-url-env | action | 1 |  |

## Files with sites and no output

None. Every file the counting rule found a declaration site in yielded a node of
that family, or a row naming the file.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 459 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 5 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 0 |

| family | sites |
|---|---|
| ways in over HTTP | 464 |
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
