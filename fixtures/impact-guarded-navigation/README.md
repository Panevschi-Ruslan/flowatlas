# impact-guarded-navigation fixture

Impact that never walks back along a navigation, from a guard to the screens
it guards, or across a channel into everything publishing there (P372), and
says what lies beyond the channels once per consumer (P378). Three
repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/impact-guarded-navigation/store-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-guarded-navigation/store-web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-guarded-navigation/store-bot/tsconfig.json --noEmit
```

## The back end - `store-api` (Nest)

- `GET /api/shops/items` is the one route serving `ItemsService.listByShop`.
- `POST /api/tickets/:ticketId/ack` and the chat webhook `POST /api/hooks/chat`
  both call `TicketsService.acknowledge`.
- `POST /api/orders`, `PATCH /api/orders/:orderId/status` and
  `POST /api/orders/:orderId/pay` publish on `shop:${shopId}:orders`;
  `POST /api/orders/:orderId/pay` also on `shop:${shopId}:paid`, and
  `PATCH /api/orders/:orderId/status` and `DELETE /api/orders/:orderId` on
  `shop:${shopId}:closed`.

## The web front end - `store-web` (Angular)

- `/dashboard` (`DashboardComponent.loadData`) and `/history` call
  `ItemsClient.getItems`, which requests the list route.
- `/board` (`TicketBoardComponent`) reaches `TicketBoardService.acknowledge`
  through `resolve` and `routeAction`. `TicketFormComponent.submit`, shown at
  `/tickets/new` and `/tickets/:ticketId/edit`, navigates to `/board` with
  `navigate`, and `TicketDetailComponent.close` with `navigateByUrl`.
- `LoginComponent.handleAuth` signs in, then navigates to `/dashboard`.
- `authGuard` (on every screen but `/login`) sends a visitor who is not signed
  in to `/login`; `roleGuard` (on `/analytics`, `/analytics/matrix` and
  `/orders`) sends one who is no manager to `/dashboard`. Both call
  `AuthService`.
- `/orders` calls `POST /api/orders` and `DELETE /api/orders/:orderId`.

## The bot - `store-bot` (Nest, telegraf, redis)

- `/items` requests the list route through `ApiClient.getItems`.
- `StoreBot.onStatusEvent`, on every message of `shop:*:orders`,
  `shop:*:paid` and `shop:*:closed`, fetches the list again through the same
  route.

## What the answers say

- `impact` on `TicketsService.acknowledge`: the route, the webhook and
  `/board`. Before P372 it also listed `/tickets/new`, `/tickets/:param/edit`
  and `/tickets/:param`, whose code navigates to the board.
- `impact` on `ItemsService.listByShop`: the route, `/dashboard`, `/history`,
  the bot command and the bot's event way in, `complete: true`;
  `throughChannels` says the bot's consumer once, with its three channels and
  the five ways in beyond any of them (the four publishing routes and
  `/orders`), each counted once. Before P378, three rows, one per channel,
  each repeating the routes and the samples (4, 1 and 3 ways in). Before
  P372, 17 rows: the ways in beyond the channel, `/login`
  (navigating to the dashboard), every screen the two guards are on (the role
  guard redirects to the dashboard, and the sign-in guard to the login
  screen), and the ticket screens again.
- `impact` with `channel: "shop:*:orders"`: the four beyond it, each
  `via: "channel shop:*:orders"`; with `channel` the bot's consumer, the five
  beyond any of its channels, `acrossConsumer` naming it.
- `who_calls` on `ItemsService.listByShop`: the same ways in under `waysIn`,
  and the bot's consumer once under `throughChannels`, its ways in counted
  with no sample, `next` naming the impact call that lists them.
- `impact` on `AuthService.role`, which the role guard calls: the three
  screens the role guard is on - a guard's own code reaches what it guards.
- `find_symbol`: `DashboardComponent.loadData` from `screen /dashboard`,
  `TicketBoardComponent.routeAction` from `screen /board`, each with one way
  in.
