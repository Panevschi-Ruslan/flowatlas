# payload - a fresh clone, no dependencies installed - what a stranger gets

Next.js, nested application roots, a heap the default limit does not hold.

|  |  |
|---|---|
| repository | `payloadcms/payload` |
| commit | `124b55a8747d9b45db0af30aad337569d37a9b3e` |
| read | `.` |
| read by | payload-monorepo (`nextjs`) |
| source files counted | 4459 |
| extent counted over | `.` alone (not a member of any workspace here) |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 288 |
| rpc | 9 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 288 |  |
| addresses claimed by more than one declaration | 0 | a collision, or one service holding two applications |
| declarations with a body attached | 288 | 288 against 128: **more found than the rule can see, so this is not a fraction** |
| …whose body reaches anything | 65 | 65 of 128 |
| …behind middleware or a guard | 0 | 0 of 128 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 8 |
| `/examples` | 111 |
| `/templates` | 110 |
| `/test` | 58 |

1 more at 1 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 160 | 36 |
| requests between services | 161 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | nothing of this kind here |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | 0 of 2 |
| components | 1915 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 897 | not counted by the rule |

## What it could not read

894 places somebody could act on, 560 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-client-unread | action | 1 |  |
| api-path-dynamic | action | 75 |  |
| call-dynamic-receiver | info | 553 |  |
| db-package-unread | action | 1 |  |
| db-receiver-name-only | action | 289 |  |
| dynamic-config-key | action | 7 |  |
| dynamic-http-url | action | 74 |  |
| route-handler-unread | action | 259 |  |
| route-wildcard-only | action | 35 |  |
| target-route-not-found | action | 32 |  |
| type-depth-exceeded | info | 1 |  |
| type-generic-uninstantiated | info | 6 |  |
| type-unresolved | action | 98 |  |
| unknown-base-url-env | action | 23 |  |

## Files with sites and no output

**3 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them. That is a reader giving up in
silence, which is the class this gate exists for; a limit somebody has decided to
accept belongs in the exemption list with a sentence beside it.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 2 |
| `packages/next/src/routes/rest/index.ts` | routes | 6 |
| `templates/ecommerce/src/app/(app)/next/exit-preview/GET.ts` | routes | 1 |

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
