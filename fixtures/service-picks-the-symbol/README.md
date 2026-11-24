# service-picks-the-symbol fixture

Answers that never say they are complete when they are not (P381): a route
two services serve under the same path, said aloud with and without the
service that picks it; a filter that keeps one service's callers; a name
nothing holds; impact summed by kind, and on several symbols at once; code
called only through a route nothing requests; and routes no caller joins,
one judged dead and one a maybe. Four repositories and one configuration, so
`flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/service-picks-the-symbol/lending-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/service-picks-the-symbol/lending-gateway/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/service-picks-the-symbol/reader-web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/service-picks-the-symbol/desk-bot/tsconfig.json --noEmit
```

## The back end - `lending-api` (Nest)

- `GET /books/:bookId` (`BooksController.findOne` -> `BooksService.findOne`)
  is requested by the reader's book screen and by the gateway, which the desk
  bot asks: `who_calls({symbol: "GET /books/42", service: "lending-api"})`
  lists the screen, the gateway route and the bot, complete.
- `POST /books/:bookId/hold` runs `HoldsService.place`; the book screen
  requests it.
- `DELETE /books/:bookId/hold` runs `HoldsService.release` and no code
  requests it: the route is `dead`, so `release`, which the route's handler
  calls, has `reach: "dead"` with `throughDead: true`, not a bare alive.
- `POST /books/:bookId/extend` is requested as `renew`, one segment off: no
  caller joins it, and it is judged a maybe, not dead. `list_entries({service:
  "lending-api", reach: "dead"})` lists the release route alone and says it is
  not complete; `called: false` lists both.

## The gateway - `lending-gateway` (Nest)

- `GET /books/:bookId`, the same path as the back end's, asks the back end
  through `BooksClient.fetch`. `who_calls({symbol: "GET /books/42"})` answers
  both routes in one call, the back end's first (more is joined to it).

## The reader - `reader-web` (Angular)

- `/book/:bookId` (`BookPageComponent`) requests the book and places a hold;
  `/shelf` (`ShelfPageComponent`) lists the books and renews one, through
  `POST /books/:id/renew`, which no route serves.

## The desk bot - `desk-bot` (Nest, Telegraf)

- `/book` asks the gateway for a book through `GatewayClient.book`.

`impact({symbol: "BooksService.findOne"})` sums the ways in by kind, each the
file handling it - the book screen, the bot, the gateway's controller - and
names the back end's own route as `changing`.
