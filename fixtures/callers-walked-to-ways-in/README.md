# callers-walked-to-ways-in fixture

`who_calls` answers "who calls this, up to the ways in" in one call (P376): a
class whose methods share callers, and a chain longer than a fixed depth.
Two repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/callers-walked-to-ways-in/store-web/tsconfig.json --noEmit
```

`store-web/node_modules` holds the hand-written stubs for `@angular/core`,
`@angular/common`, `@angular/router` and `rxjs`.

## The back end - `stock-api` (Nest)

- `StockService` is the class asked about. Its four methods share callers:
  `CheckoutService.place` calls `level` and `reserve`,
  `CheckoutService.cancel` calls `release` and `level`, and
  `StockJobs.nightly` (`@Cron`) calls `level` and `restock`.
- `POST /checkout` and `DELETE /checkout/:sku` hand work to the checkout
  service.
- `GET /reports/daily` reaches `level` five calls down:
  `ReportsController.daily` -> `ReportsService.daily` -> `ReportBuilder.build`
  -> `section` -> `row` -> `StockService.level`. A walk to a fixed depth of 3
  stopped before the route.

## The front end - `store-web` (Angular)

- `/checkout` (`CheckoutComponent`) places and cancels through `StoreClient`,
  requesting both checkout routes.
- `/reports` (`ReportComponent`) reads the daily report.

## What the graph server answers

- `who_calls` on `StockService.level`, no depth: the two nearest hops of
  callers, and the six ways in once each in `waysIn`, nearest first, with
  `hops` and `by`: the cron, both checkout routes, the report route, and the
  two screens. `complete: true`, no `next` asking for a deeper walk.
- `who_calls` on `StockService`: each method's direct callers (`calls` names
  the method), and each way in once with `reaches`, the methods it reaches:
  the report route and screen reach `level` alone.
- `who_calls` with `symbols` `reserve` and `restock`: each one's direct
  callers, and three ways in said once for both, each with the one it reaches.
- With `depth: 3`, the tree alone, cut, and `next` names the call without
  depth.
