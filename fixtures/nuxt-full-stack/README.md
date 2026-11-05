# nuxt-full-stack fixture

One Nuxt application: pages in `.vue` files and the Nitro server beside them
(P233). It is both halves of one service (R88), so a button in a page reaches
the application's own `server/api` route and that route's failures, all
`static`, with no second repository and no base address.

Written the way Nuxt's documentation writes an application: auto-imported
`defineEventHandler`, `readBody`, `getRouterParam`, `createError`, `$fetch` and
`useFetch` with no import line, a Pinia setup store, and a `tsconfig.json`
that extends `.nuxt/tsconfig.json`, which a fresh clone does not have.

| What | Where | What the graph says |
|---|---|---|
| a page | `pages/index.vue`, `pages/orders/[id].vue` | `ui_component` at `/` and `/orders/:param` |
| a button | `@click="create"` | handles `create`, which requests `POST /api/orders` |
| a store action | `@click="orders.remove(id)"` | handles `useOrdersStore.remove`, which requests `DELETE /api/orders/:param` |
| `useFetch` in setup | `pages/orders/[id].vue` | the page requests `GET /api/orders/:param` |
| Nitro routes | `server/api/orders.get.ts`, `orders.post.ts`, `orders/[id].get.ts`, `orders/[id].delete.ts` | entries with the verb from the file name |
| failures | `throw createError({ statusCode: 404 })` | the route's `fails` |
| middleware | `server/middleware/auth.ts` | in front of every route |
