# peertube - a fresh clone, no dependencies installed - what a stranger gets

Angular and Express in one repository.

|  |  |
|---|---|
| repository | `Chocobozzz/PeerTube` |
| commit | `faa76bad2c1969a088ef1df38dc666dfe7259b5c` |
| read | `server`, `client` |
| read by | peertube-client (`angular`), peertube-server (`express`) |
| source files counted | 2136 |
| extent counted over | `server` alone (a member of `.`, declaring no package of it); `client` alone (a member of `.`, declaring no package of it) |
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
| addresses claimed by more than one declaration | 0 | a collision, or one service holding two applications |
| declarations with a body attached | 0 | 0 of 343 |
| …whose body reaches anything | 0 | 0 of 343 |
| …behind middleware or a guard | 0 | 0 of 343 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

No addresses.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 0 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | nothing of this kind here |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | 0 of 85 |
| components | 330 | 330 of 330 |
| clicks | 307 | 307 of 307 |
| every other binding a template makes | 1006 | not counted by the rule |

## What it could not read

1454 places somebody could act on, 2939 the tool
reports as a limit of static reading, and 234 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 2417 |  |
| db-layer-unread | action | 3 |  |
| dynamic-config-key | action | 1 |  |
| entry-http-types-unmatched | info | 1 |  |
| handler-not-a-method | nothing | 234 |  |
| handler-not-found | action | 35 |  |
| inject-token-unresolved | info | 284 |  |
| route-link-dynamic | info | 35 |  |
| route-screen-unread | info | 18 |  |
| route-target-unresolved | action | 117 |  |
| type-depth-exceeded | info | 54 |  |
| type-generic-uninstantiated | info | 130 |  |
| type-unresolved | action | 1298 |  |

## Files with sites and no output

**83 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them. That is a reader giving up in
silence, which is the class this gate exists for; a limit somebody has decided to
accept belongs in the exemption list with a sentence beside it.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 85 |
| `server/core/controllers/activitypub/client.ts` | routes | 27 |
| `server/core/controllers/activitypub/inbox.ts` | routes | 3 |
| `server/core/controllers/activitypub/outbox.ts` | routes | 2 |
| `server/core/controllers/api/abuse.ts` | routes | 7 |
| `server/core/controllers/api/accounts.ts` | routes | 8 |
| `server/core/controllers/api/automatic-tags.ts` | routes | 6 |
| `server/core/controllers/api/blocklist.ts` | routes | 1 |
| `server/core/controllers/api/bulk.ts` | routes | 1 |
| `server/core/controllers/api/client-config.ts` | routes | 1 |
| `server/core/controllers/api/config.ts` | routes | 11 |
| `server/core/controllers/api/custom-page.ts` | routes | 2 |

and 71 more.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 343 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 330 |
| `template-click-binding` | a click bound in a template | 307 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 85 |

| family | sites |
|---|---|
| ways in over HTTP | 343 |
| screens | 330 |
| things a person can click | 307 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 85 |

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 5 to 15 s, peak resident memory 0.5 to 1 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
