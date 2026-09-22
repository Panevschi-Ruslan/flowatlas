# nest-broker-markers fixture

The repo with no broker at all: `package.json` names `@nestjs/common` and
`@nestjs/core` and nothing else. Events go through an in-house
`EventBusService.publish(channel, payload)`, which no detection rule can see — so
this fixture is where the two escape hatches are exercised, the config-driven
`custom` adapter (D3) and the `@Emits` / `@Consumes` markers (I10).

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-broker-markers/tsconfig.json --noEmit
```

No `node_modules/` here: there is nothing to stub.

## The two escape hatches

`flowatlas.config.json` declares the bus as an ordinary adapter built from data —
no technology name in core, no privileged code path (I2):

```json
"broker": { "custom": [{ "name": "event-bus", "channelKind": "channel",
  "producers": [{ "receiverType": ["EventBusService"], "method": "publish",
                  "channelArg": 0, "payloadArg": 1, "kind": "event" }],
  "consumers": [] }] }
```

`src/markers.ts` is a local stand-in for `@flowatlas/markers`, which is a workspace
package and is deliberately not linked into `fixtures/node_modules`. It
re-declares `Emits` and `Consumes` with the same names and argument shape; the
extractor reads the decorator name and its first argument out of the source, so
the stand-in exercises the same path the published package would.

`consumers` is empty on purpose: the bus's `on(channel, listener)` subscriptions
in `projections.service.ts:19-20` must produce nothing by themselves. The markers
are the only thing that makes those methods consumers, which is exactly the case
I10 reserves markers for.

## Producers — `src/orders/orders.service.ts`

| Call site / marker | Line | Channel | `meta.kind` | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|
| `bus.publish('order.created', event)` | 27 | `order.created` | `event` | static | — |
| `@Emits('order.created')` + `bus.publish('order.created', event)` | 35, 37 | `order.created` | `event` | **static** (one edge, not two) | — |
| `@Emits('order.exported')`, no broker call in the method | 44 | `order.exported` | `event` | marker | — |
| `@Emits('order.archived')` | 54 | `order.archived` | `event` | marker | — |
| `bus.publish(this.channelFor('archived'), event)` | 56 | none | `event` | heuristic | `channel-dynamic` |
| `bus.publish('order.cancelled', event)` | 62 | `order.cancelled` | `event` | static | — |

`meta.adapter` is `custom:event-bus` on every static row.

**The duplicate case (D5), lines 35-37.** The marker names the channel the static
producer already resolves, so the marker edge is dropped and the method yields
exactly one `emits` edge, the static one. §12: "the duplicate `@Emits` produces
no second `emits` edge". P11 flags the now-redundant marker later; P04 stays
quiet about it.

**The opposite case, lines 54-56.** The marker and the static producer describe
*different* things — the static channel is computed and stays unresolved — so
both survive: a `marker` edge to `channel:order.archived` and a `static` producer
with no channel and `channel-dynamic`. D5 dedupes on `(method, channel)`, never
on the method alone.

## Consumers — `src/orders/projections.service.ts`

| Marker | Line | Channel | `meta.entryId` | Confidence |
|---|---|---|---|---|
| `@Consumes('order.created')` | 25 | `order.created` | `null` | marker |
| `@Consumes('order.cancelled')` | 32 | `order.cancelled` | `null` | marker |

Each yields `consumer` + `consumes` + `handles`, all with
`confidence: "marker"` (§12). `channel:order.created` ends up shared by two
producers (lines 27, 37) and one consumer; `channel:order.cancelled` by one of
each — the producer-to-consumer chain inside a single repo, with no broker
library involved.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `this.channelFor('archived')` | `src/orders/orders.service.ts:56` | `channel-dynamic`, hint `add @Emits('<topic>') on OrdersService.archive` — which is precisely what line 54 already does |

## What must **not** happen

- No `producer` for `bus.publish` if `adapters.broker.custom` is absent: nothing
  in `package.json` may be read as a broker.
- No second `emits` edge for `createAndNotify` (D5).
- No `consumer` for the `bus.on(...)` subscriptions: `consumers` is empty in the
  config, and inferring them would be a guess.

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.

## Naming more than one channel (R38)

Four methods say the same thing four ways — `@Emits('a', 'b')`, `@Emits(['a',
'b'])`, `@Emits(CATALOGUE)` through an `as const` array, and a stack of two
single annotations. Each must produce one producer, whose label names every
channel it publishes, and one `emits` edge per channel at `marker` confidence.
A list that reads differently from the stack it shortens is the fault the
ticket was raised about.

Two more are there because they must not be silent: `@Emits([])` names nothing
and `@Emits(7 as unknown as string)` names something that is not a name.
Neither draws an edge, and `doctor` reports each — `marker-names-nothing` and
`marker-arg-not-a-name`. Before R38 both were read as "no annotation here", on
a method that publishes, which is the one place an annotation is ever written.
