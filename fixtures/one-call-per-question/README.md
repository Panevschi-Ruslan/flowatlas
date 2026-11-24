# one-call-per-question fixture

A question an agent asks is one call (P382): the inputs it writes are taken as
it writes them, a message type given as the channel is answered on the channels
carrying it, every input error names the exact call to make, a class's code
answers its skeleton as plain text, and a detail-2 flow says each fact once.
Two repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/one-call-per-question/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/one-call-per-question/ops-bot/tsconfig.json --noEmit
```

## The publisher - `shop-api` (Nest)

- `OrdersController` (`api/orders`) holds four routes over sixty lines: a field
  with an initialiser, a constructor, `PATCH :orderId/cancel` (its body read
  only by `ClientGuard`, which runs first), `POST :orderId/ready`, and
  `POST :orderId/notes` and `GET :orderId/notes` with bodies of several lines.
- `OrdersService` publishes `ORDER_READY` and `ORDER_CANCELLED` on
  `order_updates` through the project's own `EventBus.publish`, which the
  configuration describes as a producer.
- `DeskService.requestHelp` publishes `{ type: 'HELP_REQUESTED', deskNumber,
  note }` on `desk_events`; `FloorService.callStaff` publishes the same type,
  `{ type: 'HELP_REQUESTED', table, note }`, on `floor_events`.

## The consumer - `ops-bot` (Nest)

- `POST /events/orders` is marked `@Consumes('order_updates')` and dispatches
  by `event.type`; `BotService.handleOrderCancelled` cancels on the shop
  through `ShopClient.cancelOrder` (`PATCH /api/orders/${orderId}/cancel` with
  `{ userRef }`).
- `NotifyService.onDeskEvent` (`desk_events`) reads `evt.deskId`, which the
  shop never sends; `FloorWatcher.onFloorEvent` (`floor_events`) reads
  `evt.table` and `evt.note`, both sent.

## What it proves

- `check_contract({route: 'PATCH /api/orders/:orderId/cancel', field:
  'userRef'})` answers the guard's read in one call: `route` is read as
  `edge`, the parameter's name as any other's.
- `check_contract({channel: 'HELP_REQUESTED'})` answers the type on both
  channels that carry it, each compared alone (`deskId` missing on
  `desk_events`, nothing on `floor_events`); `{channel: 'ORDER_READY'}` on
  `order_updates`, the one that carries it.
- `check_contract({})`, a route and a channel that name nothing each answer an
  error with the calls to make in `next`.
- `get_source({symbol: 'OrdersController'})` answers the class's skeleton as
  plain text, each body folded with its line numbers; `whole: true` the class;
  `verbose: true` the JSON document.
- `describe_for_prompt` answers its Markdown as plain text.
- `get_flow` at detail 2 on `PATCH /api/orders/:param/cancel` names no
  reader's meta and no edge type its step's signature says.
