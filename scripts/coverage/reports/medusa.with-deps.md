# medusa - dependencies installed with `--ignore-scripts`

a file-system router with no reader.


|  |  |
|---|---|
| repository | `medusajs/medusa` |
| commit | `62a520014886df3838aa9f31f2990afecae38333` |
| read | `packages/medusa` |
| read by | medusa (`medusa`) |
| source files counted | 6650 |
| extent counted over | `packages/medusa` plus 72 declared package(s): `packages/admin/admin-bundler`, `packages/admin/admin-sdk`, `packages/admin/admin-shared`, `packages/admin/admin-vite-plugin`, `packages/admin/dashboard`, `packages/cli/medusa-cli`, `packages/core/core-flows`, `packages/core/framework`, `packages/core/js-sdk`, `packages/core/modules-sdk`, `packages/core/orchestration`, `packages/core/query`, `packages/core/types`, `packages/core/utils`, `packages/core/workflows-sdk`, `packages/deps`, `packages/design-system/icons`, `packages/design-system/ui`, `packages/medusa-telemetry`, `packages/medusa-test-utils`, `packages/modules/analytics`, `packages/modules/api-key`, `packages/modules/auth`, `packages/modules/cache-inmemory`, `packages/modules/cache-redis`, `packages/modules/caching`, `packages/modules/cart`, `packages/modules/currency`, `packages/modules/customer`, `packages/modules/event-bus-local`, `packages/modules/event-bus-redis`, `packages/modules/file`, `packages/modules/fulfillment`, `packages/modules/index`, `packages/modules/inventory`, `packages/modules/link-modules`, `packages/modules/locking`, `packages/modules/notification`, `packages/modules/order`, `packages/modules/payment`, `packages/modules/pricing`, `packages/modules/product`, `packages/modules/promotion`, `packages/modules/providers/analytics-local`, `packages/modules/providers/analytics-posthog`, `packages/modules/providers/auth-emailpass`, `packages/modules/providers/auth-github`, `packages/modules/providers/auth-google`, `packages/modules/providers/auth-oidc`, `packages/modules/providers/caching-redis`, `packages/modules/providers/file-local`, `packages/modules/providers/file-s3`, `packages/modules/providers/fulfillment-manual`, `packages/modules/providers/locking-postgres`, `packages/modules/providers/locking-redis`, `packages/modules/providers/notification-local`, `packages/modules/providers/notification-sendgrid`, `packages/modules/providers/payment-stripe`, `packages/modules/providers/search-postgres`, `packages/modules/rbac`, `packages/modules/region`, `packages/modules/sales-channel`, `packages/modules/search`, `packages/modules/settings`, `packages/modules/stock-location`, `packages/modules/store`, `packages/modules/tax`, `packages/modules/translation`, `packages/modules/user`, `packages/modules/workflow-engine-inmemory`, `packages/modules/workflow-engine-redis`, `packages/plugins/draft-order` |
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
| http | 490 |

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address. An address is an address within one application: a service
that creates two of them has two address spaces, and the third row counts the
addresses that exist only because the id says which application serves them —
every one of which used to be overwritten by the first claim on it. It counts for
every reader now: a file-system router used to put the application in the *path*
instead, which kept its ids apart at the price of an address no framework serves,
and R125 made it answer the same way as everything else. That is why a repository
addressed that way reads zero here before R125 and its true number after.

|  | count | of what the counting rule found |
|---|---|---|
| addresses placed | 490 |  |
| addresses claimed by more than one declaration | 0 | two handlers of one application; one of them is dead code |
| addresses told apart only by their application | 0 | each was overwritten before R119, silently and with no total moving |
| declarations with a body attached | 488 | 488 of 491 |
| …whose body reaches anything | 155 | 155 of 491 |
| …behind middleware or a guard | 484 | 484 of 491 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/admin` | 410 |
| `/auth` | 20 |
| `/store` | 54 |

6 more at 5 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 20 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 118 | 118 against 15: **more found than the rule can see, so this is not a fraction** |
| …that name a table | 16 | 16 of 118 |
| tables | 15 | 15 against 1: **more found than the rule can see, so this is not a fraction** |
| components | 1776 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 868 | not counted by the rule |

## What it could not read

3180 places somebody could act on, 6555 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 6284 |  |
| channel-const-unresolved | action | 1 |  |
| channel-dynamic | action | 8 |  |
| db-handover-unstated | action | 1 |  |
| db-layer-unread | action | 1 |  |
| db-receiver-name-only | action | 40 |  |
| dynamic-cache-key | action | 79 |  |
| dynamic-config-key | action | 9 |  |
| dynamic-http-url | action | 5 |  |
| test-directory-skipped | info | 158 |  |
| type-depth-exceeded | info | 27 |  |
| type-generic-uninstantiated | info | 86 |  |
| type-unresolved | action | 2934 |  |
| unknown-db-package | action | 102 |  |

## Files with sites and no output

None beyond what is baselined. Every other file the counting rule found a
declaration site in yielded a node of that family, or a row naming the file.

### What this gate cannot see

Whatever the result above says, 4 kinds of failure get through this
assertion, and each was established by breaking something on purpose rather than
by argument. The list is `BLIND` in `read-gate.mjs`; this section renders it,
so that neither half of the result can travel without the other.

**R117 - A family this target writes in a style the counting rule has no probe for.**

A query count fell from 77 to 0 on one target and this gate could not have caught it: the rule has no probe for that repository’s query style, so the denominator was 0 and the per-file assertion had nothing to assert over. A vacuous check passes by saying nothing and reads exactly like a check that looked. The instrument for that is the report’s own wording - "no denominator: the rule has no probe for it" rather than "nothing of this kind here" - and not this gate.

**R119 - Two applications colliding, where the file that loses is named by an edge.**

A graph was broken on purpose - two applications collided and one controller’s file contributed nothing - and the gate answered `read gate ok`. The mechanism is structural rather than a tuning problem: the surviving entry takes a `handles` edge to *each* controller’s method, a `handles` edge from an entry speaks for the routes of the file it is recorded in (R160 narrowed this to its own family and left it true), so the losing file is answered and the gate skips it. Strength 2 asks whether anything was said about a file; a collision is two files having the same thing said about them. R119 needed a snapshot fixture for exactly this reason.

**R110 - A wrong value.**

A mount read at the wrong address produces a node, in the right file, for the right family, and every count matches. Only a reader that can read the mount can know the address is wrong, so this is a fix and not a gate.

**R111 - A file where one of three verbs was dropped (strength 3, deliberately not done).**

Strength 3 would compare sites found against nodes plus rows per file. It needs a probe-to-adapter mapping, and the counting rule’s whole authority rests on having no per-target judgement in it; that mapping is new judgement in exactly that file, and somewhere a future change could be tuned to pass rather than fixed. Recorded as not done rather than left to be rediscovered.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 4 |
| `exported-verb-handler` | an exported handler named for an HTTP verb, in a file a router serves | 487 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 15 |
| `model-declaration` | a table or model declared as a class or a schema | 1 |

| family | sites |
|---|---|
| ways in over HTTP | 491 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 15 |
| tables or models declared (an upper bound) | 1 |

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
