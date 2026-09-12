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
| `client.emit(this.config.get('ORDER_TOPIC'), dto)` | 99 | none | `event` | heuristic | `channel-from-config` |
| `client.emit(topic, dto)` | 104 | none | `event` | heuristic | `channel-dynamic` |
| `client.emit(...args)` | 110 | none | `event` | heuristic | `channel-dynamic` |
| `firstValueFrom(client.send<Order, OrderQuery>('get.order', query))` | 117 | `get.order` | `rpc` | static | — |
| `client.send('get.order.raw', query)` | 123 | `get.order.raw` | `rpc` | static | `rpc-return-type-unknown` |
| `telemetry.emit('order.created', …)` | 130 | — | — | — | — |

`meta.channelVia` per row: `literal` (35, 42, 51), `enum` (59), `shared-package`
(66, 72), `const` (78), `config` (99), `dynamic` (85, 91, 104, 110).

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
| `@EventPattern()` | 39 | none | `event` | — | heuristic | `channel-dynamic` |
| `@EventPattern('order.audit')` | 47 | `order.audit` | `event` | — | static | — |
| `@MessagePattern('get.order')` | 55 | `get.order` | `rpc` | `type:nest-kafka#Order` | static | — |
| `@MessagePattern('get.order.raw')` | 62 | `get.order.raw` | `rpc` | none | static | `rpc-return-type-unknown` |

Every consumer here sits on a P01 entry, so each one carries `meta.entryId` —
`entry:nest-kafka:event:<pattern>` or `entry:nest-kafka:rpc:<pattern>` — and
never duplicates it (D1, §12).

The object pattern on line 32 keeps P01's `meta.pattern` verbatim as the channel
name, so the id is `channel:{"cmd":"order.sync"}` and the two sides of the repo
agree on it.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `REGION_TOPIC` — a template literal whose hole is a call | `src/orders/topics.ts:26` | `channel-const-unresolved` |
| `LEGACY_TOPIC: string` in `@fixture/events` | `shared/events/src/index.ts` | `channel-const-unresolved` |
| `this.config.get('ORDER_TOPIC')` | `orders.service.ts:99` | `channel-from-config`, hint `add @Emits('<topic>') on OrdersService.emitConfigured` |
| `topic` parameter | `orders.service.ts:104` | `channel-dynamic`, same hint |
| `emit(...args)` spread | `orders.service.ts:110` | `channel-dynamic`; the point is that it must not crash |
| `@EventPattern()` with no argument | `orders.controller.ts:39` | `channel-dynamic`; must not crash |
| `client.send` with no type argument | `orders.service.ts:123` | `rpc-return-type-unknown` |
| `@MessagePattern` handler returning `any` | `orders.controller.ts:62` | `rpc-return-type-unknown` |

`COMPUTED_TOPIC` (`topics.ts:17`) is the mirror image of `REGION_TOPIC`: its hole
is one other const with a literal value, so it is the half of §10's computed-
initializer row that **does** resolve ("resolve nested consts one level"). If
both come out unresolved, the resolver is not following consts at all; if both
come out resolved, it is guessing.

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.
