# handler-table-dispatch fixture

A call through a table of handlers the code writes out is a call of each
element's handler (P398). Two repositories and one configuration, so
`flowatlas build` joins them.

Type-checked, never executed (the two stub modules the bot's `app.module.ts`
imports are its only errors, as in the other bot fixtures):

```
./node_modules/.bin/tsc -p fixtures/handler-table-dispatch/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/handler-table-dispatch/staff-bot/tsconfig.json --noEmit
```

## The back end - `shop-api` (Nest)

- `GET /api/orders/active` (`OrdersController.active`) calls
  `OrdersService.listActive`, the method asked about. `PATCH
  /api/orders/status` and `GET /api/stock` are the other routes the bot
  requests.
- **Reports through a table of strategies, selected by `===`, with a
  spread.** `ReportsService.BUILDERS`, a `static readonly` field, holds
  `daily` (an arrow calling the static `ReportsService.daily()`), `stock` (the
  function `stockReport` imported from `stock-report.ts`) and
  `...loadPluginReports()`, a registry filled at run time. `build(kind)` calls
  `builder.build()` on `BUILDERS.find((each) => each.kind === kind)`: an edge
  to `daily` and one to `stockReport` (`selectedBy: "equals daily"`, `"equals
  stock"`), and the call keeps its `call-dynamic-receiver` row, cause
  `table-rows-unread`, saying 1 of 3 elements is not read.

## The bot - `staff-bot` (Nest, telegraf)

`StaffApi` requests the three routes through `SHOP_API_URL`.

- **Buttons through a table of prefixes.** `StaffBot.buttonRoutes` is a field
  holding `{ prefix, handler, selfAnswers }` elements, each handler an arrow
  calling a method (`(ctx, d) => this.handleStatus(ctx, d)`,
  `(ctx, d) => this.showOrder(ctx, d)`). The `callback_query` handler picks
  one with `this.buttonRoutes.find((r) => data.startsWith(r.prefix))` and
  calls `route.handler(ctx, data)`: an edge from that handler to
  `handleStatus` and one to `showOrder`, each `via: "table"`, `selectedBy:
  "prefix set_status_"` and `"prefix view_order_"`. Not again from `setup`,
  the method it is written in: nothing but Nest calls `onModuleInit`, which
  calls `setup`, and the handler is what the way in runs. `showOrder`
  requests `GET /api/orders/active`.
- **Commands through a table a method returns.** `commands()` returns
  `{ name, run }` elements, one holding `this.listOrders.bind(this)`, one the
  function `replyHelp` imported from `replies.ts`; `setup` walks them with
  `for...of`, registering each with `bot.command(command.name, (ctx) =>
  command.run(ctx))`: one way in per element (`bot_command orders` handled by
  `listOrders`, `bot_command help` by `replyHelp`, `handlerVia: "table"`), and
  the `.bind` is no row, since the table it sits in is dispatched here.
- **Text through a table selected by `===`.** `text-router.ts`'s
  `TEXT_COMMANDS` holds `stock` (the imported function `replyStock`, which
  requests `GET /api/stock`) and `ping` (an arrow written in place, calling
  nothing of the repository's). `TextRouter.route` calls
  `match.run(ctx, this.api)` on `TEXT_COMMANDS.find((entry) => entry.command
  === text)`: an edge to `replyStock`, `selectedBy: "equals stock"`.

## What the answers say

- `who_calls` on `StaffBot.showOrder`: the `callback_query` handler that
  dispatches, reached from the bot's way in; `complete: true`, no `maybe`.
- `impact` on `OrdersService.listActive`: the route, the bot's
  `callback_query` and `/orders` ways in, `byKind.bots` naming
  `src/staff-bot.ts`, no maybe row, `complete: true`.
- `dead` on `showOrder`, `listOrders` and `replyStock`: alive, each.
