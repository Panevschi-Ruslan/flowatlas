# typed-handlers-bus-wide-subscribers fixture

Consumers whose handlers choose no type in their body, and subscribers to
every channel of a project's own bus at once (P369). Three repositories and
one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/typed-handlers-bus-wide-subscribers/shop/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/typed-handlers-bus-wide-subscribers/bot/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/typed-handlers-bus-wide-subscribers/web/tsconfig.json --noEmit
```

## The bus - `shop/src/bus/`

`EventsService` is an in-process bus over an rxjs `Subject`.
`adapters.broker.custom` describes `publish(channel, scopeId, data)` as the
producer and `subscribe(channel, handler)` as the subscriber of one channel.
`all()` hands out every frame of every channel and names none. The routing
table (`routes.ts`, a constant `Map` from a channel to a set of transports)
sends `order_updates` to the bot as well: `relayToBot`, marked
`@CallsService('bot', 'POST /events/relay')`.

`OrdersService` publishes `ORDER_READY`, `STATUS_CHANGED`, `ORDER_CANCELLED`,
`ORDER_PLACED` and `ORDER_REFUNDED` on `order_updates`; `DeskService`
publishes `HELP_REQUESTED` and `DESK_CLOSED` on `desk_alerts`.

## The bot - typed handlers and the route that dispatches to them

`RelayController.relay` (`POST /events/relay`) takes `body.message` and
`switch`es on its `type`, calling a method of `Bot` for each case. Each `Bot`
handler is marked `@Consumes('order_updates')` and reads no type itself.

| Handler | Its parameter | The route calls it under | Drawn |
|---|---|---|---|
| `handleOrderReady` | `OrderReadyEvent` (`type: 'ORDER_READY'`) | `case 'ORDER_READY'` | `ORDER_READY`, via `switch` |
| `handleStatus` | `OrderEvent` (`type: string`) | `case 'STATUS_CHANGED'`, `case 'ORDER_CANCELLED'` | both, via `switch` |
| `handlePlaced` | `OrderPlacedEvent` (`type: 'ORDER_PLACED'`) | nothing calls it | `ORDER_PLACED`, via `parameter` |
| `handleRefund` | `OrderCancelledEvent` | `case 'ORDER_REFUNDED'` | `ORDER_REFUNDED`, and a `message-type-differs` row |
| `log` | `BotEvent`, the whole union | outside the `switch` | nothing: it takes every type alike |

## The shop's own subscribers

| Class | How it subscribes | How it chooses | Drawn |
|---|---|---|---|
| `NotifyService` | `this.bus.all().subscribe(cb)` in `onModuleInit` | a static constant `Set` gating the callback, which hands the message to `dispatch(scopeId, data)`, whose `switch` chooses again | `HELP_REQUESTED` on `pageStaff`, `ORDER_READY` on `pingCustomer` |
| `MetricsService` | `this.bus.all().subscribe(cb)`, the callback only calling `this.count(scopeId, data)` | `if` in `count`, on its second parameter | `ORDER_PLACED` on `count` |
| `AuditFeed` | `this.bus.all().subscribe(cb)` | `this.kept.has(evt.type)`, a set filled when the code runs | nothing: a `message-type-unread` row |
| `DeskWatcher` | `this.bus.subscribe('desk_alerts', cb)`, the callback written in place calling two methods | `if` in the callback | `DESK_CLOSED` on `archive` |

Each subscriber through `all()` is a consumer with `everyChannelOf:
shop-bus`, joined to `order_updates` and `desk_alerts`, the channels a publish
through the bus in `shop` writes to.

## The screen

`StreamController.stream` (`@Sse('stream')`) relays `order_updates` onto a
stream; `web`'s `PickupBoard` holds it open in a `useEffect`, its
`onmessage` written in place choosing `ORDER_READY` and `ORDER_CANCELLED`
with an `if` and an `else if`.

## What an agent asks

```
who_consumes({channel: "order_updates", type: "ORDER_READY"})   Bot.handleOrderReady, NotifyService.pingCustomer, PickupBoard
who_consumes({channel: "order_updates", type: "ORDER_PLACED"})  Bot.handlePlaced (parameter), MetricsService.count
who_consumes({channel: "desk_alerts", type: "HELP_REQUESTED"})  NotifyService.pageStaff
search({query: "HELP_REQUESTED"})                               the type, with NotifyService.pageStaff as its handler
```
