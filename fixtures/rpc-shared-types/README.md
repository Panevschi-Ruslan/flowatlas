# rpc-shared-types

What an RPC caller is compared with wherever it calls from (P256): a client
typed from a router type a workspace package exports, a plain request to a
procedure's REST route, Fastify's and Hono's tRPC mounts, a client a
configured module of another workspace package builds, and a lazy branch
under an alias only the Vite configuration declares.

## One workspace, five applications, two packages

- `packages/router` (`@shop/router`) holds the orders tRPC tree
  (`orders.place`, `orders.get`) and exports `type AppRouter = typeof
  appRouter`. The `@trpc/server` and `@trpc/client` stubs at the workspace's
  root infer a procedure's input from its schema and its answer from its
  resolver, as the library does, so a client typed with `AppRouter` is typed
  from the tree itself.
- `apps/api` mounts that tree with Fastify's plugin,
  `server.register(fastifyTRPCPlugin, { prefix: '/trpc', trpcOptions: { router
  } })`: the procedures are api's ways in, at `/trpc`. It claims `VITE_API_URL`
  and `ORDERS_URL`.
- `apps/edge` serves its own ledger tree twice: Hono's middleware,
  `trpcServer({ router, endpoint: '/rpc' })`, and the fetch adapter written in
  a Hono handler with `endpoint: '/legacy'`. `entries.record` is mounted at
  `/rpc` and `/legacy`. It claims `LEDGER_URL`.
- `apps/catalog` is an oRPC tree served by an OpenAPI handler under `/api`.
  Each procedure is a REST route as well: `GET /api/products/{id}`, `GET
  /api/products` (input `{ category, limit }` from the query), `POST
  /api/products/create` (input from the body), and `PATCH
  /api/products/{id}/price`, written `inputStructure: 'detailed'` and
  `outputStructure: 'detailed'`. `reports` is `lazy(() =>
  import('@lib/reports'))`, and `@lib` is declared in `vite.config.ts` alone.
  It claims `VITE_CATALOG_URL`.
- `apps/web` (React) calls api through `createTRPCClient<AppRouter>`, and
  catalog's REST routes with axios.
- `packages/clients` (`@shop/clients`) is a NestJS package: `OrdersClientModule`
  and `LedgerClientModule`, each with `forRoot(options)` and
  `forRootAsync({ useFactory, inject })`, each building its client in a
  provider whose link's address is what the method is handed.
- `apps/worker` (NestJS) imports `OrdersClientModule.forRootAsync({ useFactory:
  () => ({ url: `${process.env.ORDERS_URL}/trpc` }) })` and
  `LedgerClientModule.forRoot({ url: `${process.env.LEDGER_URL}/rpc` })`, and is
  handed both clients by `@Inject(ORDERS_CLIENT)` and `@Inject(LEDGER_CLIENT)`.
  Its `CatalogClient` asks catalog's `GET /api/products` with axios, the query
  `{ category }` in `params`. catalog claims `CATALOG_URL` too.

## What the graph says

- api's `orders.place` and `orders.get` carry `meta.mounted` `{ protocol: trpc,
  prefix: /trpc }` from the plugin's `register` call; edge's `entries.record`
  carries `/rpc` and `/legacy`. web's `legacy.ts` sends to `VITE_API_URL` +
  `/api/trpc`: it joins `orders.get` and is `procedure-link-unserved`.
- web and worker hold the router package in their extent, because they import
  its type, and read no ways in from it: no mount of theirs serves it. Their
  calls join api's procedures by their links.
- The worker's orders calls are sent to `ORDERS_URL` + `/trpc`, read from what
  the `forRootAsync` call's factory returns, through the options token the
  client's factory injects; its ledger call to `LEDGER_URL` + `/rpc`, read from
  the object the `forRoot` call hands it. The `forRoot` / `forRootAsync` beside
  each that nothing calls provides nothing.
- catalog's `reports.daily` is read, through `@lib`, and its REST twin is
  `POST /api/reports/daily`. The note `aliases-from-config` says where `@lib`
  came from.
- The NestJS reader still says `di-token-unknown` for the two tokens: it reads
  providers written in a module's decorator, not those a configuring method
  returns.

## What `contracts` says

- Every call through the `AppRouter`-typed clients, in web and in the worker,
  is `identical` both ways: input and answer are the tree's.
- The worker's ledger call: its input is compared (`identical`), and its
  answer is `no-type-on-receiver` (the ledger client is `any`).
- web's REST callers of catalog, each compared with the input the OpenAPI
  handler assembles and with the procedure's output:
  - `getProduct(id)`: the id in the address, the answer agrees.
  - `listTea()`: `{ category, limit }` in the query option; agrees.
  - `sortedBy(category)`: `?category=…&sort=price` in the address: `limit`
    missing (`missing_required`, error), `sort` not taken (`extra_field`,
    info).
  - `createProduct(name, price)`: the body lacks `sku` (`missing_required`,
    error).
  - `productCard(id)`: reads a `title` nothing answers (`missing_required`,
    error) and does not read `name` (`extra_field`, info).
  - `reprice(id, price)`: the detailed route's `{ params: { id }, body: { price
    } }` and the output's `body`; agrees.
- The worker's `CatalogClient.teas()`: the server's request writes `{ category }`
  in `params`, and `limit` is missing (`missing_required`, error).
- A path parameter and a query key are compared by name alone: the address
  carries text, and the procedure's schema decides whether it coerces it.
