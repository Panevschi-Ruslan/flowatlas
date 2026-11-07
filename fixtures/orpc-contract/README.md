# orpc-contract

A contract-first oRPC service (P58): the routes, inputs, outputs and failures
written on a contract, implemented elsewhere, and served as REST routes.

## Two services

- `orders` is an Express service. `src/contract.ts` declares `orders.list` and
  `orders.cancel` with `oc` chains under `oc.prefix('/shop').router({...})`;
  nothing there runs. `src/router.ts` implements it: `os = implement(contract)
  .$context<Context>()`, a guarded starting point `staff = os.use(requireStaff)`,
  and `staff.orders.list.handler(...)` for each member. `src/server.ts` hands
  requests under `/api` to an `OpenAPIHandler` built from the router.
- `shop` is a React front end whose client is built from the contract alone with
  an `OpenAPILink`, sending to `${VITE_ORDERS_URL}/api`.

## What to watch

- The implementation writes only the handler. The input (`z.object({ id:
  z.string() })`), the output, the errors (`NOT_FOUND` 404, `ALREADY_SHIPPED` 409)
  and the route (`DELETE /shop/orders/{id}`, with the contract router's prefix)
  are read from the contract member the property accesses name.
- `requireStaff` is in front of every procedure, through `staff` and `os`.
- The OpenAPI handler's prefix is the options argument of `handler.handle(req,
  res, { prefix: '/api' })` - the Node adapter's third argument, where the fetch
  adapter's is the second - so the REST routes are `GET /api/shop/orders` and
  `DELETE /api/shop/orders/:param`.
- `orders.refund` is implemented and the contract has no such member:
  `procedure-contract-unread`, and the procedure is read with what the
  implementation writes, which is no route - so its REST route is `POST
  /api/orders/refund`, from its keys.
- `meta.fails` on `orders.cancel`: the 400 of its input, the 403 `requireStaff`
  throws, and the two declared failures its handler throws through `errors`, at
  the statuses the contract declares.
- The shop's `client.orders.list(...)` and `client.orders.cancel(...)` join their
  procedures with `via: link-url`, the link's protocol `openapi` matching the
  mount. Its hand-written `fetch(..., { method: 'DELETE' })` joins the REST route.

## The stubs

`express`, `@orpc/server`, `@orpc/contract`, `@orpc/openapi` and `zod` under
`orders`, `@orpc/client` and `@orpc/openapi-client` under `shop`. The contract
package the shop imports is not installed, which is what a front end built
against a published contract looks like in a clone.
