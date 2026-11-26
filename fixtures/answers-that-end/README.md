# answers-that-end fixture

Answers that end the question (P403). Three repositories and one
configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/answers-that-end/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answers-that-end/packing-worker/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answers-that-end/web/tsconfig.json --noEmit
```

## The shop - `shop-api/`

`OrdersController` serves `GET /api/orders/:id` and three `POST`s
(`ready`, `delay`, `cancel`), each publishing on `packing_events` through
the project's own bus (`ShopBus`, described in `adapters.broker.custom`):
`ORDER_READY`, `ORDER_DELAYED`, `ORDER_CANCELLED`. `Receipts` takes
`ORDER_READY` off the channel and reads the order back with
`OrdersService.findOne`, so the three `POST`s reach `findOne` only across
the channel.

## The packing worker - `packing-worker/`

Three consumers of `packing_events`: `PackBoard` chooses `ORDER_CANCELLED`
in a `switch`; `AuditFeed` tests the type against a set filled when the
code runs (`this.kept.has(event.type)`); `CourierPager` tests it against a
list filled the same way and passes on what it keeps. No code chooses
`ORDER_DELAYED`.

## The screen - `web/`

A React screen at `/orders/:id`, `OrderPage`, calls `fetchOrder`, whose
request lands on `GET /api/orders/:id`.

## What the snapshots hold

- `who_calls.request-settled`: compact, `settled` says where the request
  lands and that the one way in, the screen, is listed; no `next`.
- `impact.through-channel-settled`: compact, the three ways in that break
  are listed and the publishers beyond the channel counted in
  `throughChannels` with a sample; `settled` and no `next`. Verbose, no
  impact on the channel is suggested: the count is whole.
- `who_consumes.selection-unread`: `ORDER_DELAYED` is selected by no code
  that runs; `selectionUnread` names `AuditFeed.onEvent` and
  `CourierPager.onEvent`, each with its line and what was not read, and
  `left` points at them.
- `who_calls.common-name-maybe` (verbose only): nothing calls
  `AuditFeed.start`, and its file holds a call not read, so it may be called;
  `start` is `Scanner.start`'s name too, so `confirm` searches its call,
  `.start(`.
