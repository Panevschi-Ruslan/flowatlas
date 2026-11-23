# impact-guarded-navigation fixture

Impact that never walks back along a navigation, from a guard to the screens
it guards, or across a channel into everything publishing there (P372). Three
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
  `DELETE /api/orders/:orderId` publish on `shop:${shopId}:orders`.

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
- `StoreBot.onStatusEvent`, on every message of `shop:*:orders`, fetches the
  list again through the same route.

## What the answers say

- `impact` on `TicketsService.acknowledge`: the route, the webhook and
  `/board`. Before P372 it also listed `/tickets/new`, `/tickets/:param/edit`
  and `/tickets/:param`, whose code navigates to the board.
- `impact` on `ItemsService.listByShop`: the route, `/dashboard`, `/history`,
  the bot command and the bot's event way in, `complete: true`;
  `throughChannels` counts the four ways in beyond `shop:*:orders` (the three
  publishing routes and `/orders`). Before, 17 rows: those four, `/login`
  (navigating to the dashboard), every screen the two guards are on (the role
  guard redirects to the dashboard, and the sign-in guard to the login
  screen), and the ticket screens again.
- `impact` with `channel: "shop:*:orders"`: those four, each
  `via: "channel shop:*:orders"`.
- `impact` on `AuthService.role`, which the role guard calls: the three
  screens the role guard is on - a guard's own code reaches what it guards.
- `find_symbol`: `DashboardComponent.loadData` from `screen /dashboard`,
  `TicketBoardComponent.routeAction` from `screen /board`, each with one way
  in.
