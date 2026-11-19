# settings-branches-helpers fixture

A Next `web` whose server code and browser code reach two services through
settings chosen by a condition nobody settles, or read inside a function
handed nothing. What P302 reads:

1. **A condition over two settings, in place or in a helper.**
   `isProd ? process.env.ORDERS_URL : process.env.ORDERS_DEV_URL` is decided
   where the code runs, so the value is one of the two settings. It is rooted
   at the first, `ORDERS_URL`, with `ORDERS_DEV_URL` where it may go instead
   (`baseUrlAlso`), and the address is a guess, since which one a deployment
   reads is not written (a join by a setting is `heuristic` either way). The
   helper `ordersBase()` returning that condition is read the same way, as
   are the two returns of `ordersV1()`, each writing `/orders` after its
   setting: the returns agree on the path.
2. **A function handed nothing.** `catalogBase()` returns
   `process.env.CATALOG_URL ?? 'http://localhost:4600'`; what it returns is
   the setting, with its fallback (`baseUrlDefault`). `urls.catalog()`, a
   function an object holds, is read the same way, its parameter at its
   default `''`, which settles its branch to the bare setting.

`orders` claims `ORDERS_URL` and `catalog` claims `CATALOG_URL` (and the
browser's `NEXT_PUBLIC_` spellings), so every request joins, `heuristic` as
every join by a setting is.

| Request | Joins |
|---|---|
| `GET ${isProd ? ORDERS_URL : ORDERS_DEV_URL}/orders/open` (`server/orders.ts`) | orders `GET /orders/open` |
| `GET ${ordersBase()}/orders` (`server/orders.ts`) | orders `GET /orders` |
| `GET ${ordersV1()}/late` (`server/orders.ts`) | orders `GET /orders/late` |
| `GET ${catalogBase()}/items` (`server/orders.ts`) | catalog `GET /items` |
| `GET ${urls.catalog()}/categories` (`server/orders.ts`) | catalog `GET /categories` |
| `GET ${ordersBase()}/orders` (`components/Orders.tsx`) | orders `GET /orders` |
| `GET ${catalogBase()}/items` (`components/Orders.tsx`) | catalog `GET /items` |
