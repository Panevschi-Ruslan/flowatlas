# next-workspace-api

A Next.js application whose API lives in a workspace package beside it (R179):
a tRPC tree split into per-feature routers, served a feature at a time, and a
browser wrapper whose verb is a member of the options its callers hand in.

## One workspace, one application, one package

- `packages/api` (`@shop/api`) holds the tree. `routers/orders/_router.ts`
  (`list`, `place`) and `routers/catalog/_router.ts` (`search`) are assembled
  by `routers/shop/_router.ts` under `orders` and `catalog`, and that under
  `shop` by `routers/_app.ts`, which exports `type AppRouter`.
  `createNextApiHandler.ts` wraps the library's handler under its own name, so
  that a file serving a feature is one line.
- `apps/web` serves each feature's tree in a file of its own:
  `pages/api/trpc/orders/[trpc].ts` is `createNextApiHandler(ordersRouter)`,
  `pages/api/trpc/catalog/[trpc].ts` is `createNextApiHandler(catalogRouter)`.
  Nothing mounts the root. `components/Orders.tsx` calls
  `trpc.shop.orders.list`, `trpc.shop.orders.place` and
  `trpc.shop.catalog.search` through `createTRPCReact<AppRouter>()`.
- `apps/web/lib/request.ts` is `send(path, payload?, init?)`, sending
  `fetch(path, { method, ..., ...init })` with `const method = init?.method ||
  'POST'`. `components/Session.tsx` calls it three times: `signIn` and
  `signOut` hand no init, `whoAmI` hands `{ method: 'GET' }`. The App Router answers `POST
  /api/session/login`, `GET /api/session/me` and `POST /api/session/logout`.

## What the graph says

- The root in the package is web's tree, because web serves the trees it holds:
  the three ways in are `shop.orders.list`, `shop.orders.place` and
  `shop.catalog.search`, named from the root as the client writes them, each
  `served` by its feature's file and `mounted` at `/api/trpc/orders` or
  `/api/trpc/catalog`. Each of the three calls joins its procedure. Before
  R179 a root of a workspace package that this service did not mount itself
  was read as a tree imported only for its type, so all three ways in were
  dropped and every call read `procedure-not-found`.
- Each session request carries the verb its caller decides: `POST
  /api/session/login`, `GET /api/session/me`, `POST /api/session/logout`, each
  joined to its route. Before R179 the verb was unread (`api-method-dynamic`)
  and none of the three joined; before P91 it was read as `GET`, which was
  wrong for two of them.
