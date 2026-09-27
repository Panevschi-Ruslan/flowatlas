# immich - dependencies installed with `--ignore-scripts`

NestJS at scale, Kysely, an in-house bus.


|  |  |
|---|---|
| repository | `immich-app/immich` |
| commit | `f8f4051a24fffa49accb96bd4f107f8b8d5915e9` |
| read | `server` |
| read by | immich (`nestjs`) |
| source files counted | 464 |
| extent counted over | `server` plus 2 declared package(s): `packages/plugin-sdk`, `packages/sdk` |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Dependencies

| where | manager | exit | note |
|---|---|---|---|
| `.` | pnpm | 0 | installed |

## Ways in

| kind | entry points |
|---|---|
| event | 2 |
| http | 303 |

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
| addresses placed | 303 |  |
| addresses claimed by more than one declaration | 0 | two handlers of one application; one of them is dead code |
| addresses told apart only by their application | 11 | each was overwritten before R119, silently and with no total moving |
| declarations with a body attached | 303 | 303 of 303 |
| …whose body reaches anything | 300 | 300 of 303 |
| …behind middleware or a guard | 303 | 303 of 303 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 303 |

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 0 | 0 |
| requests between services | 6 | 0 |
| channels | 3 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 579 | 579 of 579 |
| …that name a table | 561 | 561 of 579 |
| tables | 61 | 61 of 68 |
| components | 9 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

1231 places somebody could act on, 286 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| call-dynamic-receiver | info | 38 |  |
| call-module-ref | action | 5 |  |
| channel-const-unresolved | action | 5 |  |
| channel-dynamic | action | 2 |  |
| consumer-handler-unresolved | action | 3 |  |
| db-layer-unread | action | 21 |  |
| db-receiver-name-only | action | 1141 |  |
| di-token-unknown | action | 1 |  |
| di-type-unresolved | action | 1 |  |
| dynamic-cache-key | action | 6 |  |
| dynamic-http-url | action | 6 |  |
| dynamic-table-name | action | 18 |  |
| entry-http-types-unmatched | info | 1 |  |
| module-controllers-unread | action | 1 |  |
| module-import-dynamic | action | 7 |  |
| type-depth-exceeded | info | 206 |  |
| type-generic-uninstantiated | info | 41 |  |
| type-unresolved | action | 14 |  |

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

A graph was broken on purpose - two applications collided and one controller’s file contributed nothing - and the gate answered `read gate ok`. The mechanism is structural rather than a tuning problem: the surviving entry takes a `handles` edge to *each* controller’s method, an edge recorded at a site counts as the reader having read that line, so `spokenFor` contains the losing file and the gate skips it. Strength 2 asks whether anything was said about a file; a collision is two files having the same thing said about them. R119 needed a snapshot fixture for exactly this reason.

**R110 - A wrong value.**

A mount read at the wrong address produces a node, in the right file, for the right family, and every count matches. Only a reader that can read the mount can know the address is wrong, so this is a fix and not a gate.

**R111 - A file where one of three verbs was dropped (strength 3, deliberately not done).**

Strength 3 would compare sites found against nodes plus rows per file. It needs a probe-to-adapter mapping, and the counting rule’s whole authority rests on having no per-target judgement in it; that mapping is new judgement in exactly that file, and somewhere a future change could be tuned to pass rather than fixed. Recorded as not done rather than left to be rediscovered.

## The denominators

Counted by the one rule in `scripts/coverage/counting-rule.mjs`, which is
applied identically to all eight targets and knows nothing about any of them.

| probe | what it counts | sites |
|---|---|---|
| `nest-route-decorator` | an HTTP method decorator on a controller method | 303 |
| `registered-route-call` | a verb called on a router or an application | 0 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 579 |
| `model-declaration` | a table or model declared as a class or a schema | 68 |

| family | sites |
|---|---|
| ways in over HTTP | 303 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 579 |
| tables or models declared (an upper bound) | 68 |

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and `extent.mjs` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.

## Cost

Wall clock 5 to 15 s, peak resident memory 1 to 2 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
