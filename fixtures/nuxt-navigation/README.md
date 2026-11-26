# nuxt-navigation fixture

A Nuxt application whose pages, components and route middleware navigate:
`navigateTo(...)` by path, by a template of one and by name, `<NuxtLink to>`,
a redirect in a middleware, an address out of the application, and a middleware
the root component adds once it is mounted (P265).

## The application

| What | Where | What the graph says |
|---|---|---|
| a link | `<NuxtLink to="/orders">` in `pages/index.vue` and `pages/orders/[id].vue` | `calls` from the page to `pages/orders/index.vue`, `meta.navigates: /orders`, `meta.link: NuxtLink` |
| a link back | `<NuxtLink to="/">` in `pages/orders/index.vue` | `calls` to `pages/index.vue`; the two pages link to each other, and `cycles` reports no cycle: a navigation is left out of its walk |
| a link by a name a page writes | `<NuxtLink :to="{ name: 'receipt', ... }">` in `pages/index.vue`; `definePageMeta({ name: 'receipt' })` in `pages/receipts/[id].vue` | `calls` to `pages/receipts/[id].vue`, `meta.byName: true` |
| by the name Nuxt gives a file | `navigateTo({ name: 'orders-id', params })` in `open` of `pages/index.vue` | `calls` from `open` to `pages/orders/[id].vue`, `meta.byName: true` |
| a path written as a template | ``navigateTo(`/orders/${id}`)`` in `show` of `pages/orders/index.vue` | `calls` to `pages/orders/[id].vue`, `meta.navigates: /orders/${id}` |
| in place of the page | `navigateTo('/', { replace: true })` in `done` of `pages/login.vue` | `calls` to `pages/index.vue`, `meta.replace: true` |
| a redirect | `return navigateTo('/login')` in `middleware/auth.ts` | `calls` from the middleware to `pages/login.vue`, `meta.redirects: true` |
| a navigation stopped | `return abortNavigation()` in `middleware/auth.ts` | the middleware's node: `meta.abortsNavigation: true` |
| out of the application | `navigateTo('https://pay.example.com/checkout', { external: true })` in `pay` | no edge; note `navigation-external` |
| an address no page shows | `navigateTo('/archive')` in `lost` | no edge; `navigation-unresolved` (`why: missing`) |
| an address written as code | `navigateTo(to)` in `go` | no edge; `navigation-unresolved` (`why: dynamic`) |
| a middleware added once mounted | `onMounted(() => addRouteMiddleware(async () => ...))` in `app/app.vue` | from every page, first in its order, `meta.mounted: true`, `meta.setup: app/app.vue`, `meta.firstNavigation: false`; it requests `POST /api/seen` |

Nothing is installed; the manifest declares `nuxt`.
