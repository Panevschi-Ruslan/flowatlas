# search-takes-a-sentence fixture

`search` and `find_symbol` take a sentence or a name written another way
(P383): "where is the order cancelled", "what handles payments", "order
cancel", `cancelOrder`. Each name in the graph is split into its words once
(camel, snake and kebab case, path segments), stored in an FTS5 table with a
stemming tokenizer, and a query's words, stop words dropped, are ranked: only
the names holding as many of the words as the best, then by how many the
name holds, by kind (a way in first), by reach (code that runs first), then
BM25 (the name weighted five times its service and file). An answer found
this way is never `complete`, its `left` saying `fuzzy: …`; each row says the
words it holds (`matched`).

Two repositories and one configuration, so `flowatlas build` joins them.

## The back end - `shop-api` (Nest), in `shop-backend/`

- `OrdersController` (`orders`): `GET`, `POST :orderId/cancel`,
  `POST :orderId/refund`.
- `PaymentsController` (`payments`): `POST`, handled by `capture`.
- `CancellationTokens`, a decoy: its name holds "cancellation", which stems as
  "cancelled" does, and no word for an order, so it ranks below every name
  holding both.

## The front end - `shop-web` (Angular), in `shop-frontend/`

- `OrdersClient.cancel` posts to `/orders/${orderId}/cancel`: named `cancel`,
  so `cancelOrder` and "order cancel" are held by no name as written and are
  found by their words.
- `PaymentsClient.pay` posts to `/payments`.
- `OrdersComponent`, the `/orders` screen, calls both.

## What the snapshots hold

- `search` for "where is the order cancelled": `best` holds the cancel route
  first, then the service method, its handler, `OrdersClient.cancel` and the
  screen's handler, each with `matched: ["order", "cancelled"]`. The decoy
  holds one of the two words and is left out, counted in `left` among the
  rows holding fewer. It answered "nothing matches" before.
- `search` for "what handles payments": the payments route first, then the
  code named for payments.
- `search` for "cancel OR refund": both routes first, the cancel route (called
  by the screen) before the refund route (`reach: dead`, nothing calls it),
  then the code holding either word, ten rows and `left` saying one more.
- `find_symbol` for "order cancel" and `cancelOrder`: `OrdersClient.cancel`
  and the cancel route, never complete. They answered no match,
  complete, before.

`shop-frontend/node_modules` holds the hand-written stubs for `@angular/core`,
`@angular/common`, `@angular/router` and `rxjs`.
