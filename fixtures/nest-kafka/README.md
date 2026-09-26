# nest-kafka fixture

The channel-name resolver, end to end. Every one of the four resolution steps
(literal → const/enum incl. `sharedPackages` imports → `config.get` → dynamic)
has a call site here, in that order, plus both producer kinds a `ClientProxy`
offers (`emit` → `event`, `send` → `rpc`) and the consumers that pair with them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-kafka/tsconfig.json --noEmit
```

> Until `pnpm install` links the workspace package, this is the one fixture that
> does not type-check clean: `src/orders/orders.service.ts` imports
> `@fixture/events`, which lives at `fixtures/shared/events`. One error,
> `TS2307`, and nothing else.

`node_modules/kafkajs` and `node_modules/@nestjs/config` are hand-written stubs
(committed). `@nestjs/microservices` is **not** stubbed — it is installed for
real in `fixtures/node_modules`, so `ClientProxy`, `@EventPattern`,
`@MessagePattern` and `Transport` resolve to the library's own declarations.

Detection: `kafkajs` in `package.json` and `Transport.KAFKA` in `src/main.ts:12`
are the two halves of the `nestjs-kafka` rule (§7). The `KAFKA_CLIENT` token is
registered with that transport in `src/app.module.ts:17-18`, which is the D4
tie-breaker.

## Producers — `src/orders/orders.service.ts`

| Call site | Line | Channel | `meta.kind` | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|
| `client.emit('order.created', dto)` | 35 | `order.created` | `event` | static | — |
| `client.emit('order.created', dto)` (2nd method) | 42 | `order.created` | `event` | static | — |
| `client.emit('order.created', row)` inside `.then()` | 51 | `order.created` | `event` | static | — |
| `client.emit(Topics.ORDER_PAID, dto)` | 59 | `order.paid` | `event` | static | — |
| `client.emit(EVENTS.orderShipped, dto)` | 66 | `order.shipped` | `event` | static | — |
| `client.emit(SharedTopics.OrderArchived, dto)` | 72 | `order.archived` | `event` | static | — |
| `client.emit(COMPUTED_TOPIC, dto)` | 78 | `order.computed` | `event` | static | — |
| `client.emit(REGION_TOPIC, dto)` | 85 | none | `event` | — | `channel-const-unresolved` |
| `client.emit(LEGACY_TOPIC, dto)` | 91 | none | `event` | — | `channel-const-unresolved` |
| `client.emit({ name: 'order.checksum', data: {} }, dto)` | 104 | none | `event` | heuristic | `channel-dynamic` |
| `client.emit(this.config.get('ORDER_TOPIC'), dto)` | 112 | none | `event` | heuristic | `channel-from-config` |
| `client.emit(topic, dto)` | 117 | none | `event` | heuristic | `channel-dynamic` |
| `client.emit(...args)` | 123 | none | `event` | heuristic | `channel-dynamic` |
| `firstValueFrom(client.send<Order, OrderQuery>('get.order', query))` | 130 | `get.order` | `rpc` | static | — |
| `client.send('get.order.raw', query)` | 136 | `get.order.raw` | `rpc` | static | `rpc-return-type-unknown` |
| `telemetry.emit('order.created', …)` | 143 | — | — | — | — |

`meta.channelVia` per row: `literal` (35, 42, 51), `enum` (59), `shared-package`
(66, 72), `const` (78), `config` (112), `dynamic` (85, 91, 104, 117, 123).

Line 104 is the one that must produce a row and nothing else. The argument is a
readable record, and a readable record is still not a name: the address is one
property of it and the rest is the payload, so its stable text used to become a
channel of its own — `channel:{"data":{},"name":"order.checksum"}`, beside the
`channel:order.checksum` the handler at line 40 produces. Two nodes for one
channel, and the publish pointed at the one nothing else in any repository could
ever write (R83). Which property carries the address is this queue's convention;
guessing it is how a tool joins services that never speak.

The last row emits **nothing**. `TelemetryService` is declared in this repo, so
its type origin is not a broker package and no `custom` adapter matches it: an
adapter that keys on the method name instead of on the receiver's origin fails
exactly there, and only there.

Line 51 is the callback row: the call sits in an arrow passed to `.then()`, and
the producer must be attributed to `importAll`, the enclosing method.

Lines 35, 42 and 51 share one `channel:order.created` node between three
producers and three `emits` edges.

## Consumers — `src/orders/orders.controller.ts`

| Handler | Line | Channel | `meta.kind` | `returns` | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `@EventPattern('order.created')` | 18 | `order.created` | `event` | — | static | — |
| `@EventPattern(Topics.ORDER_PAID)` | 25 | `order.paid` | `event` | — | static | — |
| `@EventPattern({ cmd: 'order.sync' })` | 32 | `{"cmd":"order.sync"}` | `event` | — | static | — |
| `@EventPattern('order.checksum')` | 40 | `order.checksum` | `event` | — | static | — |
| `@EventPattern()` | 47 | none | `event` | — | heuristic | `channel-dynamic` |
| `@EventPattern('order.audit')` | 55 | `order.audit` | `event` | — | static | — |
| `@MessagePattern('get.order')` | 63 | `get.order` | `rpc` | `type:nest-kafka#Order` | static | — |
| `@MessagePattern('get.order.raw')` | 70 | `get.order.raw` | `rpc` | none | static | `rpc-return-type-unknown` |

Every consumer here sits on a P01 entry, so each one carries `meta.entryId` —
`entry:nest-kafka:event:<pattern>` or `entry:nest-kafka:rpc:<pattern>` — and
never duplicates it (D1, §12).

The object pattern on line 32 keeps P01's `meta.pattern` verbatim as the channel
name, so the id is `channel:{"cmd":"order.sync"}` and the two sides of the repo
agree on it. That is what an object pattern is for, and why it survives: a flat
record of scalars is an address both ends write the same way. Line 104 of the
service is the other thing an object can be, and does not.

`channel:order.checksum`, from the handler on line 40, deliberately has only one
end. Its publish is in this repository and cannot be read, and a channel with one
end plus a row saying which publish lost it is the honest shape of that.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `REGION_TOPIC` — a template literal whose hole is a call | `src/orders/topics.ts:26` | `channel-const-unresolved` |
| `LEGACY_TOPIC: string` in `@fixture/events` | `shared/events/src/index.ts` | `channel-const-unresolved` |
| `{ name, data }` — a job, not an address | `orders.service.ts:104` | `channel-dynamic`, and no channel node |
| `this.config.get('ORDER_TOPIC')` | `orders.service.ts:112` | `channel-from-config`, hint `add @Emits('<topic>') on OrdersService.emitConfigured` |
| `topic` parameter | `orders.service.ts:117` | `channel-dynamic`, same hint |
| `emit(...args)` spread | `orders.service.ts:123` | `channel-dynamic`; the point is that it must not crash |
| `@EventPattern()` with no argument | `orders.controller.ts:47` | `channel-dynamic`; must not crash |
| `client.send` with no type argument | `orders.service.ts:136` | `rpc-return-type-unknown` |
| `@MessagePattern` handler returning `any` | `orders.controller.ts:70` | `rpc-return-type-unknown` |

`COMPUTED_TOPIC` (`topics.ts:17`) is the mirror image of `REGION_TOPIC`: its hole
is one other const with a literal value, so it is the half of §10's computed-
initializer row that **does** resolve ("resolve nested consts one level"). If
both come out unresolved, the resolver is not following consts at all; if both
come out resolved, it is guessing.

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.
