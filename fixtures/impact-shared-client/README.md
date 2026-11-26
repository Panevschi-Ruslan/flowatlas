# impact-shared-client fixture

Impact that lists only the ways in that call the changed code (P371): a
front-end client injected by screens that call other methods of it, and
screens that subscribe to a stream of the shop's events and call the method
when a message arrives. Four repositories and one configuration, so
`flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/impact-shared-client/market-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-shared-client/market-web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-shared-client/kiosk-web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/impact-shared-client/market-bot/tsconfig.json --noEmit
```

## The back end - `market-api` (Nest)

- `GET /api/items` is the one route serving `ItemsService.listByShop`, and
  `POST /api/staff/desks/:deskId/ack-call` the one serving
  `DesksService.ackCall`: the two methods `impact` is asked about.
- `POST /api/items`, `DELETE /api/admin/:shopId/bundles/:bundleId` and
  `POST /api/staff/desks/:deskId/call` publish `ITEMS_CHANGED` or
  `DESK_URGENT` on `shop:${shopId}:events`; `GET /api/shops/:shopId/events`
  streams the channel to the screens.
- `ALL /api/*` (`FallbackController.notFound`) answers what no specific route
  does.

## The web front end - `market-web` (Angular)

- `ItemsClient` has three methods: `getHistory` requests `GET /api/items`,
  `create` `POST /api/items`, `archive` a `DELETE` only the catch-all
  answers. `/history` calls `getHistory`, on open and when `ITEMS_CHANGED`
  arrives on the stream; `/catalog` injects the client for `create`,
  `/reports` for `archive`, `/settings` for nothing.
- `StaffBoardService` has four. `/staff` (`StaffBoardComponent`) reaches
  `ackCall` through `routeAction` <- `onUrgency`, from a click in its template
  or a `DESK_URGENT` message on the stream. `StaffOrderComponent`, shown at
  three addresses, injects it for `listDesks` and `callStaff` (whose route
  publishes `DESK_URGENT`); `/staff/desks/:deskId` for `close`.
- `ShopEventsService.connect` opens the stream; `/history` and `/staff` call
  it, and `/catalog` injects the service for `disconnect` alone.

## The kiosk - `kiosk-web` (Angular)

- `/browse` requests `GET /api/items` through `KioskClient.browse`; `/order`
  injects the client for `order` (`POST /api/items`) and `forward`, a path
  read in part that only the catch-all is sure to answer.

## The bot - `market-bot` (Nest, telegraf)

- `bot.command('items', (ctx) => this.showItems(ctx))` in
  `MarketBot.onModuleInit`; `showItems` requests `GET /api/items` through
  `AppService.getActive`. The call written in the registration is the
  command's, not `onModuleInit`'s.

## What the answers say

- `impact` on `ItemsService.listByShop`: the route, `/history`, `/browse` and
  the bot command, `complete: true`. Before P371 it listed 13 rows: the routes
  publishing `ITEMS_CHANGED` and `DESK_URGENT`, the screens calling those
  (`/catalog`, `/order`, the three staff order addresses), all `via: "GET
  /api/items"`, and `MarketBot.onModuleInit` as a maybe row.
- `impact` on `DesksService.ackCall`: the route and `/staff` alone. Before,
  10 rows.
- `impact` on `ShopEventsService.connect`: `/history` and `/staff`, never
  `/catalog`, which injects the service for something else.
- `impact` on the catch-all: `/reports` and `/order`, whose requests no
  specific route answers; no request a specific route answers.
- `find_symbol`: `ItemsClient.getHistory` reached from `screen /history`,
  with no `ways` (four before), `StaffBoardService.ackCall` from `screen
  /staff`.
