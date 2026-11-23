# fields-read-and-sent fixture

Which code reads or sends a field of a message or a request body, answered in
one call (P368). Two repositories and one configuration, so `flowatlas build`
joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/fields-read-and-sent/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/fields-read-and-sent/ops-bot/tsconfig.json --noEmit
```

## The publisher - `shop-api` (Nest)

- `OrdersService` publishes two typed frames on `order_updates` through the
  project's own `EventBus.publish`, which the configuration describes as a
  producer: `ORDER_READY` (`OrderReadyFrame`: `type`, `orderId`, optional
  `label`) and `ORDER_CANCELLED` (`type`, `orderId`, `reason`).
- `DeskService.requestHelp` publishes `{ type: 'HELP_REQUESTED', deskNumber,
  note }` on `desk_events`: the desk's number as `deskNumber`.
- `PATCH /api/orders/:id/cancel` declares a body (`@Body() _body`) and never
  reads it; `ClientGuard` runs first, and its `canActivate` hands the request
  from `context.switchToHttp().getRequest()` to `clientRef`, which reads
  `request.body?.userRef`.
- `POST /api/orders/:id/ready` reads `body.label` in its handler;
  `POST /api/desks/:number/help` takes one field with `@Body('note')`.

## The consumer - `ops-bot` (Nest)

- `POST /events/orders` (`EventsController.receive`) is marked
  `@Consumes('order_updates')` and dispatches by `switch (event.type)` to
  `BotService.handleOrderReady`, which reads the one optional field,
  `event.label`, and `BotService.handleOrderCancelled`, which destructures
  `orderId` and `reason` and cancels on the shop through `ShopClient`.
- `NotifyService.onDeskEvent` is marked `@Consumes('desk_events')`, returns
  early unless `evt.type` is `HELP_REQUESTED`, and again when `evt.deskId` is
  missing: the field the shop never sends.

## What it proves

- `who_consumes({channel: 'order_updates', type: 'ORDER_READY', field:
  'label'})` names `BotService.handleOrderReady` and line 17, through the
  dispatch that chose it; asked for `reason` under `ORDER_READY` it names
  nothing, since that read is under `ORDER_CANCELLED`.
- `check_contract({edge: 'PATCH /api/orders/:id/cancel', field: 'userRef'})`
  names `ClientGuard.clientRef`, a guard, where the handler ignores the body.
- `check_contract({channel: 'desk_events', type: 'HELP_REQUESTED'})` says
  `deskId` is read (`NotifyService.onDeskEvent`, line 16) and not sent, and
  `deskNumber` sent and never read; the whole `order_updates` channel is
  compared type by type.
- `search({query: 'label'})` finds the field on `order_updates#ORDER_READY`,
  read once and sent once.
