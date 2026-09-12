# nest-rabbitmq fixture

`AmqpConnection.publish(exchange, routingKey, msg)` and `@RabbitSubscribe`, plus
a `ClientProxy` on the RMQ transport — the two ways a Nest repo talks to
RabbitMQ, side by side, because the `nestjs-rabbitmq` adapter owns both.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-rabbitmq/tsconfig.json --noEmit
```

`node_modules/amqplib` and `node_modules/@golevelup/nestjs-rabbitmq` are
hand-written stubs (committed). `@nestjs/microservices` is installed for real in
`fixtures/node_modules`.

The channel is the **routing key**, never the exchange: the exchange is
`producer.meta.exchange` and the queue is `consumer.meta.queue`. That is what
lets `channel:order.created` here be the same id as `channel:order.created` in
`nest-kafka` — channel ids carry no repo, no service and no transport (I6, §12).

## Why `@nestjs/microservices` is in `package.json`

This is the D4 case. `nestjs-kafka` detects on `kafkajs` **or**
`@nestjs/microservices`, so a repo that talks RabbitMQ through a `ClientProxy`
puts two adapters on the same call. What the fixture pins down is the outcome,
not which adapters ran:

- `src/orders/orders.service.ts:55` produces **one** `producer` node on
  `channel:order.cancelled`, never two.
- The `RMQ_CLIENT` token is registered with `Transport.RMQ`
  (`src/app.module.ts:22`) and `Transport.KAFKA` appears nowhere in the source,
  so the resolvable-token tie-breaker points at `nestjs-rabbitmq`: that is the
  `meta.adapter` on the producer.
- If both adapters are nonetheless recorded, they belong in the channel's
  `meta.adapters` array (D4) — one channel node either way, since `channel:` ids
  carry no adapter name.

## Producers — `src/orders/orders.service.ts`

| Call site | Line | Channel | `meta.kind` | `meta.exchange` | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `amqp.publish('orders-x', 'order.created', event, opts)` | 34 | `order.created` | `message` | `orders-x` | static | — |
| `amqp.publish(ORDERS_EXCHANGE, RoutingKeys.ORDER_REFUNDED, event)` | 41 | `order.refunded` | `message` | `orders-x` | static | — |
| `amqp.publish('orders-x', routingKey, event)` | 48 | none | `message` | `orders-x` | heuristic | `channel-dynamic` |
| `client.emit('order.cancelled', event)` | 55 | `order.cancelled` | `event` | — | static | — |

`meta.channelVia`: `literal` (34, 55), `enum` (41), `dynamic` (48). Line 41 also
shows that both arguments are resolved independently — the exchange through a
`const`, the routing key through an enum member.

## Consumers

| Handler | File:line | Channel | `meta.queue` | `meta.entryId` | Confidence |
|---|---|---|---|---|---|
| `@RabbitSubscribe({ exchange: 'orders-x', routingKey: 'order.created', queue: 'orders-created-q' })` | `src/orders/orders.consumer.ts:21` | `order.created` | `orders-created-q` | `null` | static |
| `@RabbitSubscribe({ exchange: ORDERS_EXCHANGE, routingKey: RoutingKeys.ORDER_REFUNDED, queue: 'orders-refunded-q' })` | `src/orders/orders.consumer.ts:33` | `order.refunded` | `orders-refunded-q` | `null` | static |
| `@EventPattern('order.cancelled')` | `src/orders/orders.controller.ts:13` | `order.cancelled` | — | `entry:nest-rabbitmq:event:order.cancelled` | static |

`@RabbitSubscribe` is not a P01 entry decorator, so those two consumers carry
`meta.entryId: null`. `@EventPattern` is, so the third must point back at its
entry rather than duplicating it (D1). Both cases in one fixture, on purpose.

`order.created`, `order.refunded` and `order.cancelled` each end up with one
`channel` node shared by the producer and the consumer in this repo.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `routingKey` parameter | `src/orders/orders.service.ts:48` | `channel-dynamic`, hint `add @Emits('<topic>') on OrdersService.publishTo` |

The producer on line 48 still keeps `meta.exchange: "orders-x"`: a resolved
exchange and an unresolved routing key is the normal state of a partially
dynamic publish, and dropping the whole node would lose the site.

`amqplib` is used for its types only (`ConsumeMessage`, `Options.Publish`) and
never as a call receiver, which is what a real repo does once
`@golevelup/nestjs-rabbitmq` owns the connection. It is still the detection key
for the adapter (§7).

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.
