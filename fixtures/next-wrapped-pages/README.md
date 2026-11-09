# next-wrapped-pages fixture

A Next.js storefront whose `pages/api` files all end the same way,
`export default withTracing(handler)`, and whose browser makes every request
through one function that takes the request as an object (P269). Never executed;
`auth-kit` in `node_modules` ships types only, and `metrics-kit` is declared and
not installed.

## The ways in

`lib/with-tracing.ts` holds the wrappers. Each hands the request on to the
function it was given, which is what makes it a wrapper rather than a factory.

| File | Export | Ways in | `handles` | In front |
|---|---|---|---|---|
| `pages/api/basket.ts` | `withTracing(handler)`, `handler` switching on the method it takes out of the request | `GET`, `POST`, `DELETE /api/basket` | `handler`, `wrapped` | `withTracing` |
| `pages/api/checkout.ts` | `withTracing(withSession(placeOrder))`, `placeOrder` turning away anything but `POST` | `POST /api/checkout` | `placeOrder`, `wrapped` | `withTracing`, then `withSession` |
| `pages/api/catalog/index.ts` | `withTracing(async (req, res) => …)` | `ALL /api/catalog` | the function written in place, `inline` | `withTracing` |
| `pages/api/reviews.ts` | `withMetrics(listReviews)`, a wrapper of a package nobody installed | `GET /api/reviews` | `listReviews`, `heuristic`, `wrapperUnread` naming the package | `withMetrics` |
| `pages/api/health.ts` | `makeProbe({ name })`, a factory of this repository | `ALL /api/health` | `makeProbe`, `call` | nothing |
| `pages/api/session.ts` | `sessionHandler({ cookie })`, a package's handler built from values | `ALL /api/session` | none: one `route-handler-unread` row saying the export was built | nothing |
| `app/api/stores/route.ts` | `export const GET = withTiming(readStores)` | `GET /api/stores` | `readStores`, `wrapped` | `withTiming` |

Before P269 every `pages/api` file was one `ALL` way in with nothing behind it
and a `route-handler-unread` row saying nothing this could read was behind the
export, though the hint said a wrapper handed a function of this repository is
read. The newer router read the wrapper's call as the handler, and the walk
stopped inside the wrapper at the parameter it calls.

## The requests

`lib/request.ts` is `({ url = '', method = 'GET', body, queryParams = {} }) =>
fetch(`${url}?…`, { method, … })`, and `gateways/api.gateway.ts` calls it from
the methods of the object a function hands back, `request({ url:
`${basePath}/basket`, method: 'POST' })`. Each caller's request is read at the
caller, its address the `url` it writes and its verb the `method` it writes or
the `GET` the pattern defaults to, in the browser reader and the server reader
alike, so all six join the routes above. Before, the request stayed in the
wrapper, `? /${…}`, and joined nothing.

`gateways/shipping.gateway.ts` takes its base out of the environment where it
declares it, `const { SHIPPING_URL = '' } = process.env`, which is the same read
as `process.env.SHIPPING_URL`. The request is rooted at `SHIPPING_URL` and no
service here answers it, which is the row it carries; before, its base was
unread and it said nothing about where it goes.
