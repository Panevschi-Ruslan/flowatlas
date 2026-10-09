# sveltekit-server-routes fixture

A repository whose routes are SvelteKit's `+server.ts` files and page server
modules (P42), read by the
reading every file-system router in this tool shares (P38).

Type-checked, never executed. `node_modules` holds a hand-written
`@sveltejs/kit` stub.

```
src/routes/api/orders/+server.ts                  GET /api/orders
src/routes/api/orders/[id=integer]/+server.ts     GET, DELETE /api/orders/:id
src/routes/(shop)/api/cart/+server.ts             POST /api/cart (a group drops out)
src/routes/[[lang]]/files/[...path]/+server.ts    GET /:lang?/files/:path
src/routes/about/+page.server.ts                  GET /about (its load)
src/routes/(shop)/+layout.server.ts               GET / (layout): runs with every page beneath it
src/routes/orders/[id]/+page.server.ts            GET /orders/:id (load),
                                                  POST /orders/:id (default action),
                                                  POST /orders/:id?/note (named action)
```

A page's `load` answers its GET and each of its `actions` a POST (P42): the
default at the page's address, a named one at `?/name` after it. What each
returns is its answer (P47): `{ order: Order }` for the order page's GET.

Each entry keeps `rawPath` beside its key, so a handler's params are named by
the directories the route sits in.
