# cal.com - dependencies installed with `--ignore-scripts`

Next.js in a monorepo, tRPC, wrapped Prisma.


|  |  |
|---|---|
| repository | `calcom/cal.com` |
| commit | `54343aa685ae8f33159d2f485ec4a57bad5c574a` |
| read | `apps/web` |
| read by | web (`nextjs`) |
| source files counted | 3598 |
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
| rpc | 190 |

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
| addresses placed | 84 |  |
| addresses claimed by more than one declaration | 0 | two handlers of one application; one of them is dead code |
| addresses told apart only by their application | 0 | each was overwritten before R119, silently and with no total moving |
| declarations with a body attached | 53 | 53 of 79 |
| …whose body reaches anything | 47 | 47 of 79 |
| …behind middleware or a guard | 0 | 0 of 79 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 84 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 367 | 256 |
| requests between services | 191 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 1245 | 1245 against 901: **more found than the rule can see, so this is not a fraction** |
| …that name a table | 1245 | 1245 of 1245 |
| tables | 66 | 66 of 100 |
| components | 1432 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 1045 | not counted by the rule |

## What it could not read

879 places somebody could act on, 1430 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-method-dynamic | action | 2 |  |
| api-path-dynamic | action | 28 |  |
| call-dynamic-receiver | info | 1273 |  |
| db-layer-unread | action | 2 |  |
| db-receiver-name-only | action | 399 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 32 |  |
| procedure-not-found | action | 1 |  |
| procedure-router-unread | action | 29 |  |
| route-handler-unread | action | 31 |  |
| route-unguarded | action | 3 |  |
| route-wildcard-only | action | 16 |  |
| server-action-unread | action | 2 |  |
| target-route-not-found | action | 63 |  |
| test-directory-skipped | info | 71 |  |
| type-depth-exceeded | info | 32 |  |
| type-generic-uninstantiated | info | 54 |  |
| type-unresolved | action | 267 |  |
| unknown-base-url-env | action | 2 |  |

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
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb, in a file a router serves | 44 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 35 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 870 |
| `query-builder-site` | a table named in a query builder | 31 |
| `model-declaration` | a table or model declared as a class or a schema | 100 |

| family | sites |
|---|---|
| ways in over HTTP | 79 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 901 |
| tables or models declared (an upper bound) | 100 |

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 15 to 60 s, peak resident memory 3 to 4 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
