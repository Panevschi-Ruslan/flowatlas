# request-shapes fixture

What a request carries and what it is answered with, read from four frameworks
whose handlers do not say so in their signature, and compared with an Angular
client that calls two of them.

The point of it is P29. A NestJS controller states its body with `@Body() dto:
CreateOrderDto` and its answer with a return type. An Express, Fastify or Koa
handler is `(req, res) => void` whatever it reads, and a Next.js route file is
`(request) => Response`: the shape is inside, in a type argument, a validator,
a cast or the value handed to the call that answers. Each framework is read by a
description of where those places are, and what is found goes on the route's
`handles` edge under the keys a NestJS route has always used.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/request-shapes/orders-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/request-shapes/catalog-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/request-shapes/cart-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/request-shapes/shop/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/request-shapes/admin/tsconfig.json --noEmit
```

Every `node_modules` holds hand-written stubs: `express` and `zod`, `fastify`,
`koa` and `@koa/router`, `next` and `next/server`, and the Angular and `rxjs`
ones the other Angular fixtures use.

## The routes

| Service | Route | Body | Answer | Why |
|---|---|---|---|---|
| `orders-api` | `POST /orders` | `CreateOrder` | `Order` | the route's own type arguments; `res.json` is held to `Order` |
| `orders-api` | `GET /orders/:param` | params `{ id: string }` | `Order`, `404` → `Problem` | the request's type argument; a failure kept apart |
| `orders-api` | `PATCH /orders/:param` | `{ total; note? }` | `{ id; total }` | `UpdateOrder.parse(req.body)`: a validator's output is the shape |
| `orders-api` | `POST /orders/import` | `ImportedOrders`, claimed | `{ imported }` | `req.body as ImportedOrders`: a cast, which nothing checks |
| `orders-api` | `GET /orders` | — | — | `any` both ways: nothing stated |
| `orders-api` | `POST /orders/:param/refunds` | `{ reason }`, params `{ id: string }` | `{ id; reason }`, `400` → `Problem` | `RefundRequest.safeParse(req.body)`: the result's `data` is the shape (P30) |
| `orders-api` | `GET /orders/:param/summary` | params `{ id: string }` | `{ id; total }` | `sendOk(res, …)`, the project's own helper, described in `flowatlas.config.json` (P30) |
| `orders-api` | `GET /orders/:param/status` | params `{ id: string }` | — | the status is worked out at run time: `{ open }` is kept as `statusUnknown` (P30) |
| `catalog-api` | `POST /items` | `CreateItem` | `Item` | `app.post<{ Body; Reply }>`; `reply.code(201).send(item)` |
| `catalog-api` | `GET /items/:param` | params `{ id: string }` | `Item` | `FastifyRequest<{ Params }>`; the returned value |
| `catalog-api` | `DELETE /items/:param` | — | — | nothing stated, nothing sent |
| `cart-api` | `POST /carts/:param/lines` | `AddLine`, claimed | `Cart` | `ctx.request.body as AddLine`; `ctx.body = cart` |
| `cart-api` | `GET /carts/:param` | — | — | the answer is `any` |
| `cart-api` | `DELETE /carts/:param/lines/:param` | params `{ id; sku }` | `Cart`, `404` → `LineMissing` | `ctx.status = 404` assigned in the branch before its `ctx.body` (P30) |
| `shop` | `POST /api/carts` | `CartInput`, claimed | `CartCreated`, `422` → `{ error }` | `(await request.json()) as CartInput`; `NextResponse.json(…, { status })` |
| `shop` | `ALL /api/health` | — | `Health` | `pages/api`: `NextApiResponse<Health>` holds `res.json` to it |

A framework's default - `any`, `unknown`, a dictionary of strings, Node's
`IncomingHttpHeaders` - is recorded as nothing, never as a type. Path params a
handler reads that nothing types are named by the path as written - `:id` is
`{ id: string }` - since every framework hands them over as text (P30).

## What `contracts` says about it

- `admin → orders-api POST /orders` is an **error**: the client sends a
  `NewOrder` without `customerId`, which the route's own `CreateOrder` requires.
- `admin → orders-api POST /orders/import` is the same disagreement held to a
  **warning**: the route's `ImportedOrders` is only a cast, and the finding says so.
- `orders-api GET /orders` answers through the response and states no type for
  it, so the response is unchecked with a sentence that says that, rather than
  that the handler declares no answer.
- `admin → catalog-api GET /items/:param` agrees.
