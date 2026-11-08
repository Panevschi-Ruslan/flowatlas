# nuxt-modules fixture

A Nuxt 4 application whose build adds what no file says (P251): modules of
the repository that add names, routes, a page and aliases, `dir` settings that
move its pages and its shared code, a layer beside it with a module and pages
of its own, and overrides for development and a staging build. The workspace
root declares the application, a module package and the two layers, and holds
no code. Nothing is installed.

| What | Where | What the graph says |
|---|---|---|
| a module of `modules/` | `shop/modules/catalog/index.ts` | `addImportsDir` gives `useCatalog`; `addServerHandler` serves `GET /api/catalog`, declared at the call; `extendPages` makes `runtime/pages/catalog.vue` a screen at `/catalog`, whose `@click="refresh"` reaches `GET /api/catalog` |
| a module's alias | `nuxt.options.alias['#catalog']` | `#catalog/title` in `catalog.vue` resolves, and the page calls `catalogTitle` |
| a single-file module | `shop/modules/audit.ts` | `addServerImportsDir` gives `stampRequest` to `GET /api/orders`; `addServerHandler({ middleware: true })` guards every route (`server-audit/stamp.ts`) |
| an addition written as code | `addServerHandler({ route: auditRoute })` | row `framework-module-unread`, `why: addition` |
| a module of the workspace, by name | `modules: ['audit-module']` | read at `src/module.ts`, as the module builder lays it out: `addImports` gives `useAudit`, so `@click="recordVisit"` reaches `POST /api/audit`, which the module serves |
| a layer's module, by path | `admin-layer`: `modules: ['./tools/reports']` | `useReports` from `tools/reports/`, so `@click="showReport"` reaches `GET /api/reports`; its `#reports` alias fills in (`||=`) |
| `dir.pages` | `views` in the application, `screens` in the layer | `app/views/index.vue` is `/`, `../admin-layer/screens/admin.vue` is `/admin`; `app/pages/legacy.vue` is a component and no screen |
| `dir.shared` | `common` | `#shared` is `common`; `slugify` from `common/utils` is called by the page and by `GET /api/orders` |
| packages from a registry | `@vueuse/nuxt`, `@nuxtjs/i18n` | note `framework-module-installed`: the first adds names of its own package; the second's additions are not read |
| `modules` entry as code | `process.env.EXTRA_MODULE ?? ...` | row `framework-module-unread`, `why: dynamic` |
| `$development`, `$env.staging` | `extends: ['../dev-layer']`, `dir.pages: 'pages'` | not read; note `framework-environment-differs` says what each builds that production does not |
| what was read | `nuxt.config.ts` | notes `framework-module-read`, `framework-layer-read`, `implicit-imports-from-convention`, `aliases-from-convention` |

`addComponentsDir` and `addRouteMiddleware` are read too (P255): `catalog-guard`, added `global: true`, is a `calls` edge from every page (`meta.middleware`, `meta.order`); nothing renders `CatalogCard`, so no edge reaches it.
