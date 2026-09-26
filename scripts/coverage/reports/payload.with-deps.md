# payload - dependencies installed with `--ignore-scripts`

Next.js, nested application roots, a heap the default limit does not hold.

|  |  |
|---|---|
| repository | `payloadcms/payload` |
| commit | `124b55a8747d9b45db0af30aad337569d37a9b3e` |
| read | `.` |
| read by | payload-monorepo (`nextjs`) |
| source files counted | 4459 |
| flowatlas | 0.4.1 |

## Outcome

**The tool did not finish.** build **exit 2**, doctor exit 2, link exit 0

What it said:

```
payload-monorepo skipped (extract-failed: 116: 0x1052b20b0 node::NodeMainInstance::Run() [/opt/homebrew/Cellar/node/25.9.0_3/lib/libnode.141.dylib] 117: 0x105255b98 node::Start(int, char**) [/opt/homebrew/Cellar/node/25.9.0_3/lib/libnode.141.dylib] 118: 0x18de1c4e4 start [/usr/lib/dyld])
```

It reached over 4 GB before it stopped.

## Dependencies

| where | manager | exit | note |
|---|---|---|---|
| `.` | pnpm | 0 | installed |

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
| declarations with a body attached | 0 | 0 of 128 |
| …whose body reaches anything | 0 | 0 of 128 |
| …behind middleware or a guard | 0 | 0 of 128 |

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
| tables | 0 | 0 of 2 |
| components | 0 | nothing of this kind here |
| clicks | 0 | nothing of this kind here |
| every other binding a template makes | 0 | not counted by the rule |

## What it could not read

0 places somebody could act on, 0 the tool
reports as a limit of static reading, and 0 where there
was never an edge to draw. The three are never added together.

Nothing.

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

## Cost

Wall clock 1 to 5 min, peak resident memory over 4 GB.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
