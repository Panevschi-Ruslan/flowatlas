# impact-bot-webhook fixture

impact counts every way in by what it is, and `dead` says what impact says
(P396). Three repositories and one configuration, so `flowatlas build` joins
them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/impact-bot-webhook/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-bot-webhook/courier-bot/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-bot-webhook/backoffice-web/tsconfig.json --noEmit
```

## The back end - `shop-api` (Nest, with a bot inside)

- `OrdersService.updateStatus` is the method asked about.
- `PATCH /api/orders/status` (`OrdersController.setStatus`) calls it: the
  API being changed, which the back office's screen and the courier bot
  request.
- `DeskBot` registers the command `ready` on the bot; its handler,
  `markReady`, calls the method.
- `POST /bot/desk/webhook` (`DeskBotController.receive`) hands the bot
  platform's updates to `DeskBot.handleUpdate`, which reads a button's
  callback and calls the method through `onButton`: the bot's way in, handled
  by the bot's class, not the API.

## The screen - `backoffice-web` (Angular)

- The router shows `StatusBoardComponent` at `/board`; its button requests
  `PATCH /api/orders/status`.

## The courier bot - `courier-bot` (Nest, telegraf)

- `CourierBot` registers `help` and, in a loop over a table, its buttons:
  the handler of `route.handler(ctx)` is not read (`call-dynamic-receiver`).
- `handleDelivered` requests `PATCH /api/orders/status` through
  `ShopClient.updateStatus`, and nothing the graph holds calls it.

## What the answers say

- `impact` on the method: `byKind` names the screen and both bots,
  `bots: {"courier-bot": ["src/courier-bot.ts (maybe)"], "shop-api":
  ["src/desk-bot.ts"]}` - the webhook and the command by the bot's file, the
  courier bot's handler as a maybe row of a bot; `changing` holds only
  `PATCH /api/orders/status`, never the webhook.
- `dead` on `CourierBot.handleDelivered`: `verdict: "maybe"`, with the same
  gap impact's row names (`gap:courier-bot|src/courier-bot.ts|call-dynamic-receiver`).
