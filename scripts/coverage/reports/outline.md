# outline - a fresh clone, no dependencies installed - what a stranger gets

Koa + React + socket.io + Sequelize in one repository.

|  |  |
|---|---|
| repository | `outline/outline` |
| commit | `aacc98475d1f5bb0f192665b539db00126d491ee` |
| read | `.` |
| read by | outline (`koa`, set; `link` guessed `react`) |
| source files counted | 2188 |
| extent counted over | `.` alone (not a member of any workspace here) |
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
| declarations with a body attached | 0 | 0 of 266 |
| …whose body reaches anything | 0 | 0 of 266 |
| …behind middleware or a guard | 0 | 0 of 266 |

Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

No addresses.

## What joined

|  | found | joined |
|---|---|---|
| requests from a browser | 30 | 0 |
| requests between services | 32 | 0 |
| channels | 0 | 0 with both ends |

## Storage and screens

|  | count | of what the counting rule found |
|---|---|---|
| query sites read | 0 | nothing of this kind here |
| …that name a table | 0 | nothing of this kind here |
| tables | 0 | 0 of 103 |
| components | 644 | no denominator: the rule has no probe for it |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 777 | not counted by the rule |

## What it could not read

807 places somebody could act on, 3457 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

| reason | level | places |  |
|---|---|---|---|
| api-path-dynamic | action | 4 |  |
| call-dynamic-receiver | info | 2716 |  |
| db-layer-unread | action | 7 |  |
| db-receiver-name-only | action | 13 |  |
| dynamic-config-key | action | 2 |  |
| dynamic-http-url | action | 24 |  |
| entry-http-types-unmatched | info | 1 |  |
| target-route-not-found | action | 26 |  |
| type-depth-exceeded | info | 571 |  |
| type-generic-uninstantiated | info | 169 |  |
| type-unresolved | action | 730 |  |
| unknown-base-url-env | action | 1 |  |

## Files with sites and no output

**46 file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them. That is a reader giving up in
silence, which is the class this gate exists for; a limit somebody has decided to
accept belongs in the exemption list with a sentence beside it.

| file | family | sites |
|---|---|---|
| `(anywhere)` | models | 103 |
| `plugins/discord/server/auth/discord.ts` | routes | 2 |
| `plugins/figma/server/api/figma.ts` | routes | 1 |
| `plugins/github/server/api/github.ts` | routes | 2 |
| `plugins/gitlab/server/api/gitlab.ts` | routes | 3 |
| `plugins/google/server/auth/google.ts` | routes | 2 |
| `plugins/linear/server/api/linear.ts` | routes | 1 |
| `plugins/notion/server/api/notion.ts` | routes | 1 |
| `plugins/passkeys/server/api/passkeys.ts` | routes | 3 |
| `plugins/passkeys/server/auth/passkeys.ts` | routes | 5 |
| `plugins/slack/server/auth/slack.ts` | routes | 3 |
| `plugins/webhooks/server/api/webhookSubscriptions.ts` | routes | 4 |

and 34 more.

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

Wall clock 15 to 60 s, peak resident memory 1 to 2 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
