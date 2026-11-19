# nuxt4-layout fixture

A Nuxt 4 application (P240): its code under `app/`, the server and `shared/`
beside it, and a `tsconfig.json` that refers to the four tsconfigs
`nuxi prepare` writes into `.nuxt/` - none of which a fresh clone has. Read as
Nuxt 4 documents its layout, so `~` is `app/`, the pages are under
`app/pages`, and the names Nuxt imports for a file are read as imports.

| What | Where | What the graph says |
|---|---|---|
| a page under `app/` | `app/pages/index.vue` | `ui_component` at `/` |
| a default export used unimported | `useCart()`, from `app/composables/useCart.ts` | the page calls it, and `@click="addSelected"` reaches `POST /api/cart` |
| `imports.dirs` | `searchProducts()`, from `app/queries/` | `@click="search"` reaches `GET /api/products` |
| an alias the configuration writes | `#catalog` to `app/catalog` | `@click="reload"` reaches `GET /api/products` |
| `shared/utils` | `slugify()` in the composable and in the route | called from both halves |
| `server/utils` | `addLine()`, `allProducts()` in the routes | each route calls its function |
| a name two files give | `formatPrice` in `app/composables/` and `app/utils/` | row `implicit-import-ambiguous`, joined to neither |
| a layer | `extends: ['github:example/storefront-base']` | row `framework-layer-unread` |
| what was read so | `tsconfig.json`, `nuxt.config.ts` | notes `aliases-from-convention` and `implicit-imports-from-convention` |

Nothing is installed.
