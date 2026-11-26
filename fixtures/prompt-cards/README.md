# prompt-cards fixture

A prompt that names something the graph holds gets the graph's answer before the first turn (P386). Four
repositories and one configuration, so `flowatlas build` joins them and writes `card-names.json` beside the graph;
`expected.cards/` holds the card each prompt of `scripts/card-snapshots.mjs` gets, rendered by the server's own
tools, and the index the hook reads.

Type-checked, never executed. `web/node_modules` holds the hand-written stubs for `@angular/core`,
`@angular/common`, `@angular/router` and `rxjs`.

## The repositories

- `shop-api` (Nest, `api/`), under the global prefix `api`: `OrdersController` serves `GET orders/:orderId` and
  `POST orders/:orderId/cancel`; the cancel publishes `ORDER_CANCELLED` on `shop:${id}:orders` and a line on the
  plain-named channel `audit`. `ReportsController`'s `GET reports/daily` is called by nothing.
- `stock-api` (Nest, `stock/`): an `OrdersController.findOne` spelled exactly as `shop-api`'s, serving
  `GET orders/:orderId/reserved`.
- `mailer` (Nest, `mailer/`): takes `shop:*:orders`, choosing `ORDER_CANCELLED` in a switch, and `audit`.
  `Mails.cancelled` and `Mails.subjectOf` are reached from the other repositories only across the channel.
- `shop-web` (Angular, `web/`): the `/orders` screen and its client `OrdersApiService`, whose methods request both
  back ends. `OrdersPageComponent.cancel` and `ngOnInit` are reached only from inside `shop-web`.

## What the cards show

- A route said aloud with another parameter spelling (`GET /api/orders/{orderId}`) or as a bare path gets
  `who_calls`; a handler (`OrdersController.findOne`, with `stock-api` named) `impact` on that service's only; a
  client method `find_symbol` with where its requests land; a message type (`ORDER_CANCELLED`) and a channel
  `who_emits` and `who_consumes`; `shop-api` beside "unused" `dead({service})`.
- Silent: a plain word (`audit`) unless backticked, code reached only inside its own repository, a prompt naming
  nothing. Past three names the rest are named by their calls.
