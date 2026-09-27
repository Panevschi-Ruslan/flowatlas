# payload - a fresh clone, no dependencies installed - what a stranger gets

Next.js, nested application roots, a heap the default limit does not hold.

A fresh clone is a partial read by construction: nothing a package declares
is resolved, so every figure below is a floor for this tool rather than a
measurement of it. What it still reads is what the repository’s own source
states. Installing would recover what a package *declares* - never what a
package *generates*, which `--ignore-scripts` leaves out of both states here.

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

build **exit 0**, doctor exit 2, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 288 |
| rpc | 9 |

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
| addresses placed | 288 |  |
| addresses claimed by more than one declaration | 0 | two handlers of one application; one of them is dead code |
| addresses told apart only by their application | 271 | each was overwritten before R119, silently and with no total moving |
| declarations with a body attached | 29 | 29 of 128 |
| …whose body reaches anything | 4 | 4 of 128 |
| …behind middleware or a guard | 0 | 0 of 128 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 259 |
| `/my-route` | 12 |
| `/next` | 11 |

6 more at 4 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 160 | 41 |
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

889 places somebody could act on, 560 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| ambiguous-route-application | action | 1 |  |
| api-client-unread | action | 1 |  |
| api-path-dynamic | action | 75 |  |
| call-dynamic-receiver | info | 553 |  |
| db-package-unread | action | 1 |  |
| db-receiver-name-only | action | 289 |  |
| dynamic-config-key | action | 7 |  |
| dynamic-http-url | action | 74 |  |
| route-handler-unread | action | 259 |  |
| route-wildcard-only | action | 35 |  |
| target-route-not-found | action | 26 |  |
| type-depth-exceeded | info | 1 |  |
| type-generic-uninstantiated | info | 6 |  |
| type-unresolved | action | 98 |  |
| unknown-base-url-env | action | 23 |  |

## Files with sites and no output

**3 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them, and no baseline entry accounts for
them. That is a reader giving up in silence, which is the class this gate exists
for; a limit somebody has decided to accept belongs in the exemption list with a
sentence beside it, and a limit somebody has decided to live with belongs in the
baseline with a count and a ticket.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 2 |
| `packages/next/src/routes/rest/index.ts` | routes | 6 |
| `templates/ecommerce/src/app/(app)/next/exit-preview/GET.ts` | routes | 1 |

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
