# medusa - a fresh clone, no dependencies installed - what a stranger gets

a file-system router with no reader.

|  |  |
|---|---|
| repository | `medusajs/medusa` |
| commit | `62a520014886df3838aa9f31f2990afecae38333` |
| read | `packages/medusa` |
| read by | medusa (`express`) |
| source files counted | 6683 |
| extent counted over | `packages/medusa` plus 74 declared package(s): `packages/admin/admin-bundler`, `packages/admin/admin-sdk`, `packages/admin/admin-shared`, `packages/admin/admin-vite-plugin`, `packages/admin/dashboard`, `packages/cli/medusa-cli`, `packages/core/core-flows`, `packages/core/framework`, `packages/core/js-sdk`, `packages/core/modules-sdk`, `packages/core/orchestration`, `packages/core/query`, `packages/core/types`, `packages/core/utils`, `packages/core/workflows-sdk`, `packages/deps`, `packages/design-system/icons`, `packages/design-system/toolbox`, `packages/design-system/ui`, `packages/design-system/ui-preset`, `packages/medusa-telemetry`, `packages/medusa-test-utils`, `packages/modules/analytics`, `packages/modules/api-key`, `packages/modules/auth`, `packages/modules/cache-inmemory`, `packages/modules/cache-redis`, `packages/modules/caching`, `packages/modules/cart`, `packages/modules/currency`, `packages/modules/customer`, `packages/modules/event-bus-local`, `packages/modules/event-bus-redis`, `packages/modules/file`, `packages/modules/fulfillment`, `packages/modules/index`, `packages/modules/inventory`, `packages/modules/link-modules`, `packages/modules/locking`, `packages/modules/notification`, `packages/modules/order`, `packages/modules/payment`, `packages/modules/pricing`, `packages/modules/product`, `packages/modules/promotion`, `packages/modules/providers/analytics-local`, `packages/modules/providers/analytics-posthog`, `packages/modules/providers/auth-emailpass`, `packages/modules/providers/auth-github`, `packages/modules/providers/auth-google`, `packages/modules/providers/auth-oidc`, `packages/modules/providers/caching-redis`, `packages/modules/providers/file-local`, `packages/modules/providers/file-s3`, `packages/modules/providers/fulfillment-manual`, `packages/modules/providers/locking-postgres`, `packages/modules/providers/locking-redis`, `packages/modules/providers/notification-local`, `packages/modules/providers/notification-sendgrid`, `packages/modules/providers/payment-stripe`, `packages/modules/providers/search-postgres`, `packages/modules/rbac`, `packages/modules/region`, `packages/modules/sales-channel`, `packages/modules/search`, `packages/modules/settings`, `packages/modules/stock-location`, `packages/modules/store`, `packages/modules/tax`, `packages/modules/translation`, `packages/modules/user`, `packages/modules/workflow-engine-inmemory`, `packages/modules/workflow-engine-redis`, `packages/plugins/draft-order` |
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
| declarations with a body attached | 0 | 0 of 491 |
| …whose body reaches anything | 0 | 0 of 491 |
| …behind middleware or a guard | 0 | 0 of 491 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

No addresses.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 20 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | 0 of 16 |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | 0 of 1 |
| components | 1776 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 868 | not counted by the rule |

## What it could not read

3035 places somebody could act on, 5277 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 5173 |  |
| db-layer-unread | action | 2 |  |
| db-receiver-name-only | action | 50 |  |
| dynamic-config-key | action | 9 |  |
| dynamic-http-url | action | 5 |  |
| entry-http-types-unmatched | info | 1 |  |
| type-depth-exceeded | info | 26 |  |
| type-generic-uninstantiated | info | 77 |  |
| type-unresolved | action | 2969 |  |

## Files with sites and no output

**338 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them. That is a reader giving up in
silence, which is the class this gate exists for; a limit somebody has decided to
accept belongs in the exemption list with a sentence beside it.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 1 |
| `packages/admin/admin-bundler/src/commands/serve.ts` | routes | 2 |
| `packages/core/utils/src/modules-sdk/create-pg-connection.ts` | data | 1 |
| `packages/medusa-test-utils/src/medusa-test-runner-utils/bootstrap-app.ts` | routes | 1 |
| `packages/medusa/src/api/admin/api-keys/[id]/revoke/route.ts` | routes | 1 |
| `packages/medusa/src/api/admin/api-keys/[id]/route.ts` | routes | 3 |
| `packages/medusa/src/api/admin/api-keys/[id]/sales-channels/route.ts` | routes | 1 |
| `packages/medusa/src/api/admin/api-keys/route.ts` | routes | 2 |
| `packages/medusa/src/api/admin/campaigns/[id]/promotions/route.ts` | routes | 1 |
| `packages/medusa/src/api/admin/campaigns/[id]/route.ts` | routes | 3 |
| `packages/medusa/src/api/admin/campaigns/route.ts` | routes | 2 |
| `packages/medusa/src/api/admin/claims/[id]/cancel/route.ts` | routes | 1 |

and 326 more.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 4 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 487 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 16 |
| `model-declaration` | a table or model declared as a class or a schema | 1 |

| family | sites |
|---|---|
| ways in over HTTP | 491 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 16 |
| tables or models declared (an upper bound) | 1 |

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
