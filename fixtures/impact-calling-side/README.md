# impact-calling-side fixture

Reach that never hides a maybe, and impact that answers "which ways in could
break if this method changes" in one call (P367). Three repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/impact-calling-side/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-calling-side/ops-bot/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-calling-side/backoffice-web/tsconfig.json --noEmit
```

## The back end - `shop-api` (Nest)

- `OrdersService.updateStatus` is the method asked about. It throws a
  `BadRequestException`, so every route reaching it lists that failure with
  `at` naming it: a compact answer at detail 2 leaves `at` and `file` out.
- `ArchiveHelper.copyStatus` calls it, and only `LegacyExport.run` calls the
  helper; nothing injects or makes `LegacyExport`, and its file has no step
  the reading could not follow. So `run` is `dead` and the helper `unreached`:
  no way in reaches it, and no unread call could.
- `PATCH /orders/status` (`OrdersController.setStatus`) calls it: the crossing
  both callers below request.
- `POST /hooks/chat` (`ChatHookController.receive`) hands a chat platform's
  update to `ChatUpdatesService.handleUpdate`, which calls the method
  directly: a webhook, whose caller is outside the project by design.

## The screen - `backoffice-web` (Angular)

- The router shows `StatusBoardComponent` at `/board`; its button calls
  `markReady`, which requests `PATCH /orders/status` through
  `OrdersApiService.setStatus`.

## The bot - `ops-bot` (Nest, telegraf)

- `OpsBot` registers its buttons in a loop over a table of routes,
  `this.bot.action(route.pattern, (ctx) => route.handler(ctx))`: the trigger
  is dynamic and the call has no single receiver, a `call-dynamic-receiver`
  gap in `src/ops-bot.ts`, so `OpsBot.handleStatus` is called by nothing the
  graph holds and no bot way in is drawn.
- `handleStatus` requests `PATCH /orders/status` through
  `ShopClient.updateStatus` (`SHOP_API_URL`).

## What the answers say

- `impact` on `OrdersService.updateStatus`, in one call: the screen
  `/board` (`reach: outside`, `via: "PATCH /orders/status (shop-api)"`), the
  route (`alive`), the webhook (`outside`, never `unknown`), and
  `OpsBot.handleStatus` as a `maybe` row with the gap
  (`gap:ops-bot|src/ops-bot.ts|call-dynamic-receiver`) and the same `via`;
  `complete: false`, `left` saying one chain stops at an unread call.
- `who_calls` on the method: the bot's chain (`handleStatus`, the client
  method, its request) is `maybe`, `from: "behind"`, with the gap, and
  `behind` naming `handleStatus` on the rows below it; only
  `ArchiveHelper.copyStatus` says `unreached`, `from: "none"`, and
  `LegacyExport.run` `dead`. Neither is a row of `impact`: no unread call
  could reach where that chain ends.
- `dead` on `handleStatus`: `likely-dead`, with the gap.
