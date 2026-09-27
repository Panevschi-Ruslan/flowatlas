# cal.com - dependencies installed with `--ignore-scripts`

Next.js in a monorepo, tRPC, wrapped Prisma.

|  |  |
|---|---|
| repository | `calcom/cal.com` |
| commit | `54343aa685ae8f33159d2f485ec4a57bad5c574a` |
| read | `apps/web` |
| read by | web (`nextjs`) |
| source files counted | 3611 |
| extent counted over | `apps/web` plus 24 declared package(s): `packages/app-store`, `packages/app-store-cli`, `packages/app-store/dailyvideo`, `packages/app-store/office365video`, `packages/app-store/zoomvideo`, `packages/config`, `packages/coss-ui`, `packages/dayjs`, `packages/embeds/embed-core`, `packages/embeds/embed-react`, `packages/embeds/embed-snippet`, `packages/features`, `packages/i18n`, `packages/lib`, `packages/platform/atoms`, `packages/platform/constants`, `packages/platform/enums`, `packages/platform/types`, `packages/prisma`, `packages/testing`, `packages/trpc`, `packages/tsconfig`, `packages/types`, `packages/ui` |
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
| addresses claimed by more than one declaration | 0 | a collision, or one service holding two applications |
| declarations with a body attached | 53 | 53 of 82 |
| …whose body reaches anything | 50 | 50 of 82 |
| …behind middleware or a guard | 0 | 0 of 82 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 84 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 139 | 29 |
| requests between services | 197 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | 0 of 1180 |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | 0 of 100 |
| components | 1433 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 1045 | not counted by the rule |

## What it could not read

1022 places somebody could act on, 1397 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-method-dynamic | action | 2 |  |
| api-path-dynamic | action | 28 |  |
| call-dynamic-receiver | info | 1252 |  |
| db-layer-unread | action | 44 |  |
| db-receiver-name-only | action | 416 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 40 |  |
| route-handler-unread | action | 31 |  |
| route-wildcard-only | action | 16 |  |
| server-action-unread | action | 2 |  |
| target-route-not-found | action | 63 |  |
| type-depth-exceeded | info | 84 |  |
| type-generic-uninstantiated | info | 61 |  |
| type-unresolved | action | 376 |  |
| unknown-base-url-env | action | 2 |  |

## Files with sites and no output

**236 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them. That is a reader giving up in
silence, which is the class this gate exists for; a limit somebody has decided to
accept belongs in the exemption list with a sentence beside it.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 100 |
| `apps/web/app/api/auth/forgot-password/route.ts` | data | 1 |
| `apps/web/app/api/auth/reset-password/route.ts` | data | 3 |
| `apps/web/app/api/auth/setup/route.ts` | data | 2 |
| `apps/web/app/api/auth/two-factor/totp/disable/route.ts` | data | 2 |
| `apps/web/app/api/auth/two-factor/totp/enable/route.ts` | data | 2 |
| `apps/web/app/api/auth/two-factor/totp/setup/route.ts` | data | 2 |
| `apps/web/app/api/avatar/[uuid]/route.ts` | data | 2 |
| `apps/web/app/api/cron/bookingReminder/route.ts` | data | 3 |
| `apps/web/app/api/cron/syncAppMeta/route.ts` | data | 2 |
| `apps/web/app/api/link/route.ts` | data | 2 |
| `apps/web/app/api/me/route.ts` | data | 1 |

and 224 more.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 47 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 35 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 1149 |
| `query-builder-site` | a table named in a query builder | 31 |
| `model-declaration` | a table or model declared as a class or a schema | 100 |

| family | sites |
|---|---|
| ways in over HTTP | 82 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 1180 |
| tables or models declared (an upper bound) | 100 |

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 1 to 5 min, peak resident memory 2 to 3 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
