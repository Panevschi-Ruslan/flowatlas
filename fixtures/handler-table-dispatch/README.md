# handler-table-dispatch fixture

A call through a table of handlers the code writes out is a call of each
element's handler (P398); a bot listener choosing through a table of
prefixes opens a way in per prefix, the framework calls lifecycle hooks, and
every call walk reads tables (P399). Four repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed (the two stub modules the bot's `app.module.ts`
imports are its only errors, as in the other bot fixtures; the screen's JSX
has no React types installed, as in the other React fixtures):

```
./node_modules/.bin/tsc -p fixtures/handler-table-dispatch/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/handler-table-dispatch/staff-bot/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/handler-table-dispatch/shop-web/tsconfig.json --noEmit
```

## The back end - `shop-api` (Nest)

- `GET /api/orders/active` (`OrdersController.active`) calls
  `OrdersService.listActive`, the method asked about. `PATCH
  /api/orders/status` and `GET /api/stock` are the other routes the bot
  requests; the screen and the kiosk request those and `GET
  /api/reports/:kind`, never `GET /api/orders/active`. It answers at `shop.example.test` (`hosts`).
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

`StaffApi` requests the three routes through `SHOP_API_URL`. `StaffBot` is a
provider `AppModule` registers; its `onModuleInit` calls `setup()`, which
registers every handler.

- **Buttons through a table of prefixes (P399).** `StaffBot.buttonRoutes` is
  a field holding `{ prefix, handler, selfAnswers }` elements, each handler an
  arrow calling a method (`(ctx, d) => this.handleStatus(ctx, d)`,
  `(ctx, d) => this.showOrder(ctx, d)`). The `callback_query` listener picks
  one with `this.buttonRoutes.find((r) => data.startsWith(r.prefix))`, `data`
  read off the update, and calls `route.handler(ctx, data)`: a way in per
  prefix, `bot_callback set_status_*` and `bot_callback view_order_*`, each
  at its element, handled by the element's arrow (which calls `handleStatus`,
  `showOrder`), `selectedBy: "prefix ..."`, `callbackData: { regex:
  "^view_order_" }`. The listener also answers every callback no element
  answers itself (`if (!route?.selfAnswers) await ctx.answerCbQuery()`), so
  it stays a way in, `bot_event callback_query`, with `splitByTable`, and
  draws no edge through the table. `showOrder` requests `GET
  /api/orders/active`.
- **The buttons sent.** `buttonsFor(order)` builds three:
  `view_order_${order.id}` and `set_status_${order.id}`, each held against
  its prefix, and `archive_order_${order.id}`, which no element takes: a
  `bot-button-unhandled` finding at high (no catch-all, as the listener's
  rest does not read the data).
- **Commands through a table a method returns.** `commands()` returns
  `{ name, run }` elements, one holding `this.listOrders.bind(this)`, one the
  function `replyHelp` imported from `replies.ts`; `setup` walks them with
  `for...of`, registering each with `bot.command(command.name, (ctx) =>
  command.run(ctx))`: one way in per element (`bot_command orders` handled by
  `listOrders`, `bot_command help` by `replyHelp`, `handlerVia: "table"`), and
  the `.bind` is no row, since the table it sits in is dispatched here. The
  `command.run(ctx)` call is the ways in's, not `setup`'s (P399).
- **Text through a table selected by `===`.** `text-router.ts`'s
  `TEXT_COMMANDS` holds `stock` (the imported function `replyStock`, which
  requests `GET /api/stock`) and `ping` (an arrow written in place, calling
  nothing of the repository's). `TextRouter.route` calls
  `match.run(ctx, this.api)` on `TEXT_COMMANDS.find((entry) => entry.command
  === text)`: an edge to `replyStock`, `selectedBy: "equals stock"`. The text
  listener hands the update to `TextRouter.route`, a method of another class,
  so that table is not split; the call is drawn from the listener's own
  function only, not again from `setup` (P399).
- **The lifecycle hook (P399).** `onModuleInit` carries `frameworkCalls: {
  hook: "onModuleInit", when: "startup" }`: `dead` says it and `setup` alive,
  reached from `startup (onModuleInit)`.

## The screen - `shop-web` (React)

`OrdersToolbar.tsx`'s `TOOLBAR` holds `refresh` (the file's `reload`, which
calls `loadReport`), `ready` (an arrow calling the imported `markReady`) and
`stock` (the imported `countStock`); `onAction` calls `action?.run()` on
`TOOLBAR.find((each) => each.key === key)`: an edge from the component to
each, `via: "table"`, `selectedBy: "equals ..."` (P399). The functions in
`orders-api.ts` request the shop's routes through `VITE_SHOP_API_URL`.

## The kiosk - `kiosk` (plain scripts)

`js/kiosk.js`'s `SCREENS` is a record of `{ title, open }`; `openScreen(name)`
calls `screen.open()` on `SCREENS[name]`: an edge to `showReport` and one to
`showStock`, `via: "table"` (P399), each requesting a route at
`shop.example.test`.

## What the answers say

- `who_calls` on `StaffBot.showOrder`: the element's arrow, reached from
  `bot_callback view_order_*`; `complete: true`, no `maybe`.
- `impact` on `OrdersService.listActive`: the route, `bot_callback
  view_order_*` and `bot_command orders`, `byKind.bots` naming
  `src/staff-bot.ts`, no maybe row, `complete: true`.
- `dead` on `showOrder`, `listOrders` and `replyStock`: alive, each; on
  `setup`: alive, from `startup (onModuleInit)`.
- `impact` on `TextRouter.route`: the text listener alone, no maybe row.
- `findings` of kind `bot-button-unhandled`: the archive button.
- `who_calls` on `markReady` and on `showStock`: the component, the
  kiosk's `openScreen`.
