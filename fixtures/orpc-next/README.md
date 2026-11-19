# orpc-next

An oRPC service and the clients that call it (P58): the second library of the
family `fixtures/trpc-router` and `fixtures/trpc-join` are about, read by the
same tree walk and joined by the same path.

## Two services

- `api` is a Next.js application whose ways in are an oRPC router, mounted
  twice: by an `RPCHandler` at `/rpc` (`app/rpc/[[...rest]]/route.ts`) and by an
  `OpenAPIHandler` at `/api` (`app/api/[[...rest]]/route.ts`). A server page asks
  its own procedures in process.
- `web` is a React front end whose client is `createORPCClient(new RPCLink({ url:
  `${VITE_API_URL}/rpc` }))`, with the query utilities made from it. Its
  configuration names `api` for `VITE_API_URL`.

## The server half

`src/server/router.ts` is a plain object, which is what an oRPC router is:
`os.router({...})` only installs something in front of the procedures it is
handed. So:

- `orders.list`, `orders.get` and `orders.place` are under `os.use(audit)
  .prefix('/v1').router({...})`. Each is guarded by `audit` (the router's) and
  then `requireUser` (installed once on `authed` in `base.ts`, which every chain
  begins from), in that order.
- `health` is a procedure written in place in the root.
- `reports` is `lazy(() => import('./reports'))`, followed into that module's
  default export, so `reports.daily` has the address a caller writes.
- `[section]` is a computed key: `procedure-key-dynamic`, and no way in invented.

Each procedure carries its input (`OrderQuery`), the shape the checker gives it
(`{status:'open'|'shipped'}`), what it answers (from `.output(Orders)` for
`orders.list`), the failures it declares under `meta.errors` with their statuses
(`UNAUTHORIZED` 401 from the starting point, `NOT_FOUND` 404 and `RATE_LIMITED`
429 written on `orders.get`), its route where `.route()` writes one, and where it
is mounted (`meta.mounted`: `rpc` at `/rpc`, `openapi` at `/api`).

The OpenAPI handler makes each procedure a REST route too, under `/api`: `GET
/api/v1/orders` and `GET /api/v1/orders/:param` from the routes the procedures
write (with the router's `/v1`), and `POST /api/orders/place`, `POST /api/health`
and `POST /api/reports/daily` from their keys, where no route is written and the
prefix does not apply. Each names its procedure and has the same handler and
guards.

`meta.fails` is read through P68's reader: `ORPCError('UNAUTHORIZED')` thrown by
`requireUser` (401), `errors.NOT_FOUND()` in `orders.get`'s handler (404),
`ORPCError('CONFLICT')` in the store `orders.place` calls (409), and the 400 any
procedure with an input refuses a request with before its handler runs.

## The client half

Every call is a request of kind `rpc` carrying the path, `call: handler` (the
one ending an oRPC server writes) and `meta.link`, where the link sends:
`{ protocol: rpc, path: /rpc, baseUrlEnv: VITE_API_URL }`, read through the
utilities to the client to the link.

- `useQuery(orpc.orders.list.queryOptions({ input }))`, `orpc.orders.place
  .mutationOptions()` and `client.orders.get({ id })` join `api` with `via:
  link-url`: the link's key names the service. `orpc.orders.list.key()` reads a
  cache and is not a request.
- `client.orders.refund` joins nothing: `procedure-not-found`.
- `client[section].list()` names no procedure: `procedure-path-dynamic`.
- `fetch(`${VITE_API_URL}/api/v1/orders/${id}`)` is an ordinary request and joins
  the REST route `GET /api/v1/orders/:param`.
- In `legacy.ts`, a link whose URL is a function is `procedure-link-dynamic` and
  the call joins by `apiTarget`; a link pointed at `/api` with the RPC protocol
  joins and says `procedure-link-unserved`, since only the OpenAPI handler is
  there.
- In `app/orders/page.tsx`, `createRouterClient(router).orders.list(...)` and
  `call(getOrder, ...)` are requests in process (`meta.inProcess`), joined by the
  procedure's declaration (`meta.procedureAt`), which is exact where the path
  could not be: `call(getOrder)` names a constant, not a path.

`routes` counts a procedure's REST route as called when the procedure is, and
the mount file's catch-all as called when a request crosses it, so an RPC-only
client does not make its REST routes read as dead. `POST /api/reports/daily`
is the one nothing reaches.

## The stubs

`@orpc/server`, `@orpc/openapi`, `@orpc/client`, `@orpc/tanstack-query`,
`@tanstack/react-query` and `zod` are hand-written under each service's own
`node_modules`, declaring the kind each thing is and nothing of another kind.
Nothing in the reading needs their types beyond what a schema's `_output` says.
