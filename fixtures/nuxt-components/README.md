# nuxt-components fixture

A Nuxt 4 application whose templates, pages and modules name what they use
(P255): child components by the path of their file, a layout and route
middleware by name, a module's components, middleware and server directory,
and a module's route turned on and off by the options the configuration
hands it. The workspace root declares the application, a layer beside it and
a module package, and holds no code. Nothing is installed.

| What | Where | What the graph says |
|---|---|---|
| a component of `components/` | `<CartBadge />` in `pages/index.vue` | `calls` from the page to `app/components/CartBadge.vue` (`meta.renders`); the layer's `CartBadge.vue` is left out, note `framework-layer-overridden` |
| `Lazy` | `<LazyProductList />` | `ProductList`, `meta.lazy`; the page's flow reaches its `useFetch` of `GET /api/products` |
| a `prefix` | `components: [{ path: '~/components/ui', prefix: 'Ui' }]`, `<UiButton>` | `components/ui/Button.vue` |
| `pathPrefix: false` | `components/flat/orders/OrderTotal.vue`, `<order-total />` | `OrderTotal`, kebab-case as Vue resolves it |
| a folder as a prefix | `components/base/Card.vue`, `<base-card />` | `BaseCard` |
| `.client` and `.server` | `Map.client.vue`, `Map.server.vue`, `<Map />` | an edge to each |
| a layer's component | `../base-layer/components/Rating.vue`, `<Rating />` | the page renders `Rating`, whose click requests `POST /api/ratings`, which the layer serves |
| a module's component | `addComponentsDir` in `catalog-kit`, `<SearchBox />` | the page renders `SearchBox`, whose click requests `ALL /api/search` |
| a package's component, built-ins, a custom element | `<NuxtImg>` (`@nuxt/image`), `<NuxtLink>`, `<ClientOnly>`, `<cookie-banner>` | nothing, and no row |
| a name nothing registers | `<Mystery />` | row `component-unresolved` |
| global middleware | `../base-layer/middleware/locale.global.ts`, `middleware/track.global.ts` | `calls` from every page, in Nuxt's order (`meta.order` 0, 1); `track-global` reaches `POST /api/visits` |
| a page's middleware | `definePageMeta({ middleware: ['auth', 'catalog-guard', 'audit'] })` in `pages/admin.vue` | `auth` (order 2, reaches `GET /api/session`), `catalog-guard` from the module's `addRouteMiddleware` (order 3, reaches `GET /api/brands`); `audit` names no file: row `route-middleware-unresolved` |
| layouts | `app.vue` renders `<NuxtLayout>`; `layout: 'admin'`, none, `false`, `'wide'` | `admin.vue` the application's over the layer's (order 4, reaches `GET /api/alerts`); `default.vue` for `/`, which renders `SiteHeader` (`GET /api/menu`); `/plain` none; `wide` is row `layout-unresolved` |
| `addServerScanDir` | `catalog-kit/src/runtime/server` | `GET /api/brands` from its `api/`, `log` from its `middleware/` in front of every route, `brandName` from its `utils/` |
| an option turns a route on | `catalog: { search: true }` over `defaults: { search: false }`, `if (options.search)` | `ALL /api/search` is served |
| an option turns a route off | `['./modules/reviews', { enabled: false }]`, `if (!options.enabled) return` | no `/api/reviews`; note `framework-module-read` says the call is not made |
| a module that names only its build | `catalog-kit`: `exports` names `./dist/kit.mjs` | read at `src/kit.ts`, the source in its place |
| a layer by a built path | `extends: [fileURLToPath(new URL('../base-layer', import.meta.url))]` | read by the tool, and counted by the coverage harness (I14) |

Notes `framework-layer-read`, `framework-module-read`, `framework-module-installed`,
`implicit-imports-from-convention` and `aliases-from-convention` say how it was read.
`GET /api/brands` is reached from the module's middleware and from no click.
