# outline - a fresh clone, no dependencies installed - what a stranger gets

Koa + React + socket.io + Sequelize in one repository.

A fresh clone is a partial read by construction: nothing a package declares
is resolved, so every figure below is a floor for this tool rather than a
measurement of it. What it still reads is what the repository’s own source
states. Installing would recover what a package *declares* - never what a
package *generates*, which `--ignore-scripts` leaves out of both states here.

|  |  |
|---|---|
| repository | `outline/outline` |
| commit | `aacc98475d1f5bb0f192665b539db00126d491ee` |
| read | `.` |
| read by | outline (`koa`) |
| source files counted | 2188 |
| extent counted over | `.` alone (not a member of any workspace here) |
| flowatlas | 0.4.1 |

## Outcome

build **exit 0**, doctor exit 0, link exit 0

## Ways in

| kind | entry points |
|---|---|
| http | 261 |

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
| addresses placed | 261 |  |
| addresses claimed by more than one declaration | 0 | two handlers of one application; one of them is dead code |
| addresses told apart only by their application | 0 | each was overwritten before R119, silently and with no total moving |
| declarations with a body attached | 258 | 258 of 266 |
| …whose body reaches anything | 241 | 241 of 266 |
| …behind middleware or a guard | 258 | 258 of 266 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

| first segment | addresses |
|---|---|
| `/api` | 216 |
| `/auth` | 13 |
| `/oauth` | 7 |

25 more at 14 segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 30 | 26 |
| requests between services | 32 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 724 | no denominator: the rule has no probe for it |
| …that name a table | 722 | 722 of 724 |
| tables | 34 | 34 of 103 |
| components | 644 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 777 | not counted by the rule |

## What it could not read

812 places somebody could act on, 4717 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 4 |  |
| call-dynamic-receiver | info | 3969 |  |
| db-layer-unread | action | 6 |  |
| db-receiver-name-only | action | 11 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 24 |  |
| dynamic-table-name | action | 2 |  |
| entry-http-routes-unplaced | info | 1 |  |
| route-handler-anonymous | info | 3 |  |
| route-mount-unread | action | 1 |  |
| route-path-dynamic | action | 4 |  |
| type-depth-exceeded | info | 573 |  |
| type-generic-uninstantiated | info | 171 |  |
| type-unresolved | action | 757 |  |
| unknown-base-url-env | action | 1 |  |

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
| `nest-route-decorator` | an HTTP method decorator on a controller method | 0 |
| `registered-route-call` | a verb called on a router or an application | 266 |
| `exported-verb-handler` | an exported handler named for an HTTP verb | 0 |
| `pages-api-module` | a file under `pages/api` that default-exports a handler | 0 |
| `component-declaration` | an Angular component declaration | 0 |
| `template-click-binding` | a click bound in a template | 0 |
| `prisma-call-site` | a model method called through a Prisma client | 0 |
| `query-builder-site` | a table named in a query builder | 0 |
| `model-declaration` | a table or model declared as a class or a schema | 103 |

| family | sites |
|---|---|
| ways in over HTTP | 266 |
| screens | 0 |
| things a person can click | 0 |
| places the code reaches storage | 0 |
| tables or models declared (an upper bound) | 103 |

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
