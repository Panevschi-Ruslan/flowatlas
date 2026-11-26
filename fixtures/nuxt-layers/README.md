# nuxt-layers fixture

A Nuxt 4 application built from layers (P243): one under its own `layers/`,
one beside it by path that extends another, one a package of the workspace by
its name, and one downloaded from a git host. The workspace root declares the
application and the layers beside it and holds no code. Each local layer is
read as part of the application, ranked as Nuxt ranks them: `shop` itself,
then `layers/base`, then `../ui-layer` followed by the `../tokens` it extends,
then `brand-layer`.

| What | Where | What the graph says |
|---|---|---|
| a directory of `layers/` | `shop/layers/base` | `cart.vue` calls `useCart()` from `layers/base/app/composables`, and `@click="addOne"` reaches `POST /api/cart`, which `layers/base/server/api` serves and which calls `addLine()` from its `server/utils` |
| a layer beside the application, by path | `extends: ['../ui-layer']` | `../ui-layer/pages/catalog.vue` is a screen at `/catalog`; `@click="loadAll"` reaches `GET /api/products`, served by `../ui-layer/server/api` |
| a layer a layer extends | `../ui-layer` extends `../tokens` | `@click="applyTheme"` reaches `GET /theme`, from `../tokens/server/routes` |
| a package of the workspace, by name | `['brand-layer', { meta }]` | `@click="refreshBrand"` reaches `GET /api/brand`; its `alias` `#brand` resolves to `../brand-layer/assets` |
| a page two parts give | `shop/app/pages/index.vue` and `../ui-layer/pages/index.vue` | the application's is at `/`; the layer's is a component and no screen, note `framework-layer-overridden` |
| a route two parts give | `GET /health` in `shop/server/routes` and `../tokens/server/routes` | the application's is the route; note `framework-layer-overridden` |
| a name two parts give | `formatMoney` in `layers/base/app/utils` and `../ui-layer/utils` | `shown()` calls `layers/base`'s; note `implicit-import-overridden` |
| a name one part gives twice | `formatPrice` in `../ui-layer/composables` and `../ui-layer/utils` | joined to neither, row `implicit-import-ambiguous` |
| `#layers/<name>` | `#layers/base/app/utils/limits` in `cart.vue` | resolves to the layer |
| `~` in a layer | `~/utils/limits` in `layers/base/app/components/CartBadge.vue` | the application has no `app/utils/limits`, so row `framework-layer-alias` |
| a remote layer | `github:example/analytics-layer` | row `framework-layer-unread`, `why: remote` |
| what was read | `nuxt.config.ts` | notes `framework-layer-read`, `implicit-imports-from-convention`, `aliases-from-convention` |

`GET /health` is the one route nothing calls. Nothing is installed.
