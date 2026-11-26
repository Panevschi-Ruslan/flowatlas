# answer-fields-read fixture

Which fields of a route's answer each client reads (P391). Three
repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/answer-fields-read/shop-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answer-fields-read/shop-web/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/answer-fields-read/shop-app/tsconfig.json --noEmit
```

## The routes - `shop-api` (Nest, under the global prefix `api`)

- `GET /api/orders` answers `OrderSummary[]`: `id`, `total`, `status`,
  `placedAt`, `internalNote`.
- `GET /api/orders/:id` answers `OrderDetail`: `id`, `total`, `lines`,
  `customer`.
- `GET /api/profile` answers `Profile`: `name`, `avatarUrl`.
- `GET /api/settings` answers what `JSON.parse` gives: no declared shape
  (P393).

## The web - `shop-web` (Angular)

- `OrdersService.list` and `one` hand back `this.http.get<…>(…)`.
- `/orders` (`OrdersComponent`) holds `orders$ = this.orders.list()` and its
  template walks `@for (order of orders$ | async; track order.id)`, reading
  `total` and `discount` (a field the web's own type declares and the API
  never sends), and binds each order to `<app-order-badge [order]="order">`,
  whose template reads `order.status`.
- `/orders/:id` (`OrderDetailComponent`) subscribes to `one('current')`,
  stores the order in `this.order` and reads `order.lines.length`; its
  template reads `order?.customer.name`, `line.sku` and `line.qty` of
  `@for (line of order?.lines)`, and hands the order to `email(order)`, which
  reads `order.customer.email`.

## The app - `shop-app` (React)

- `listOrders` hands back axios's `response.data` through `then`; `/orders`
  (`OrdersList`) hands it to `useQuery` as its `queryFn`, maps `data` to
  `<OrderRow key={order.id} order={order} />`, and `OrderRow` reads
  `order.status` off its props.
- `fetchProfile` hands back `response.json()`; `/profile` (`ProfileCard`)
  hands it to a state's setter and reads `avatarUrl`, `name` and `nickname`
  (never answered) where it renders the state.
- `fetchOrder('last')` is handed whole to `JSON.stringify`: what it reads is
  not known, and said.
- `fetchSettings` hands back `response.json()`; `/theme` (`ThemeBadge`) reads
  its `theme`.

## What it proves

- `check_contract({edge: 'GET /api/orders'})` lists every read of the list's
  fields in both front ends, says `discount` read and never answered, and
  `internalNote` and `placedAt` answered and read by no client.
- `check_contract({edge: 'GET /api/orders', field: 'status'})` names the two
  pieces of code that break if `status` changes: the badge and the row.
- `check_contract({edge: 'GET /api/profile'})` says `nickname`, read by the
  card at line 17, is never answered.
- `check_contract({edge: 'GET /api/orders/:id'})` reads through a member and
  a method the template hands it to, and is not complete: the app hands the
  order to `JSON.stringify`, so no field is said unused.
- `findings({kind: 'answer-field-never-returned'})` (P393) lists `nickname`
  (the card) and `discount` (the web's list), each `high`, and holds back the
  badge's `theme`: what `GET /api/settings` answers is not a shape read.
