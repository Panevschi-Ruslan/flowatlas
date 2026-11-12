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
| a page | `pages/index.vue`, `pages/orders/[id].vue`, `pages/basket.vue` | `ui_component` at `/`, `/orders/:param` and `/basket` |
| a button | `@click="create"` | handles `create`, which requests `POST /api/orders` |
| a store action | `@click="orders.remove(id)"` | handles `useOrdersStore.remove`, which requests `DELETE /api/orders/:param` |
| `useFetch` in setup | `pages/orders/[id].vue` | the page requests `GET /api/orders/:param` |
| Nitro routes | `server/api/orders.get.ts`, `orders.post.ts`, `orders/[id].get.ts`, `orders/[id].delete.ts`, `orders/[id].patch.ts`, `basket.post.ts`, `basket.delete.ts` | entries with the verb from the file name |
| failures | `throw createError({ statusCode: 404 })` | the route's `fails` |
| middleware | `server/middleware/auth.ts` | in front of every route |

What `nuxi prepare` would have written, read without it (P240):

| What | Where | What the graph says |
|---|---|---|
| `~` with no `.nuxt/` | `import { useOrdersStore } from '~/stores/orders'`, `import { useOrderApi } from '~/composables/useOrderApi'` | the page calls the store and the composable; `@click="renameIt"` reaches `PATCH /api/orders/:param` |
| a composable used with no import | `pages/basket.vue`, `useBasket()` | the page calls `composables/useBasket.ts`, which requests `POST /api/basket` |
| a utility only the template names | `@click="clearBasket"` | handles `utils/basket.ts:clearBasket`, which requests `DELETE /api/basket` |
| `#imports` | `components/AddToBasket.vue` | the component calls `useBasket` through it |
| a component by name (P255) | `<AddToBasket id="2" />` in `pages/basket.vue`, from `components/` | `calls` from the page to `AddToBasket` (`meta.renders`) |
| `server/utils` with no import | `renameOrder`, `addToBasket`, `emptyBasket` in the routes | each route calls its function |
| what was read so | `tsconfig.json`, `nuxt.config.ts` | notes `aliases-from-convention` and `implicit-imports-from-convention`, once each |
