# sveltekit-server-routes fixture

A repository whose routes are SvelteKit's `+server.ts` files, read by the
reading every file-system router in this tool shares (P38).

Type-checked, never executed. `node_modules` holds a hand-written
`@sveltejs/kit` stub.

```
src/routes/api/orders/+server.ts                  GET /api/orders
src/routes/api/orders/[id=integer]/+server.ts     GET, DELETE /api/orders/:id
src/routes/(shop)/api/cart/+server.ts             POST /api/cart (a group drops out)
src/routes/[[lang]]/files/[...path]/+server.ts    GET /:lang?/files/:path
src/routes/about/+page.server.ts                  a page, not a way in
```

Each entry keeps `rawPath` beside its key, so a handler's params are named by
the directories the route sits in.
