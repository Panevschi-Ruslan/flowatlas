# nuxt-plugins-tasks fixture

A Nuxt application whose plugins add route middleware and install a library
of components, whose server's plugins hook into every request, and whose
tasks are run by name and on a schedule (P258).

## The application

| What | Where | What the graph says |
|---|---|---|
| a global middleware added by a function alone | `addRouteMiddleware(async () => ...)` in `plugins/guards.ts` | `@0` from every page; it requests `POST /api/visits` |
| one marked `global`, held in a name | `addRouteMiddleware('audit', audit, { global: true })` | `@1` from every page |
| a named one a page names | `definePageMeta({ middleware: ['signed-in', 'reports-only'] })` in `pages/orders.vue` | `signed-in` (`@2`) from `plugins/guards.ts`, `reports-only` (`@3`) from the plugin the reports module adds with `addPlugin` |
| a name written as code | `addRouteMiddleware(useRuntimeConfig().public.guardName, ...)` | row `route-middleware-unresolved` (`dynamic`) at the call |
| a library a plugin installs | `nuxtApp.vueApp.use(ElementPlus)`; `<ElTable>`, `<ElButton>` | the library's: no edge and no row |
| the layout | `layouts/default.vue` | after the middleware, as P255 draws it |

## The server

| What | Where | What the graph says |
|---|---|---|
| a plugin a module adds | `addServerPlugin(.../nitro/timing)`, a `beforeResponse` hook | an `interceptor` behind every route |
| a plugin of the server | `server/plugins/log.ts`: `request`, `afterResponse`, `close` | `log request` in front of every route (`@0`), `log afterResponse` behind it; `close` is no step of a request |
| a plugin of a directory a module adds | `addServerScanDir(.../runtime/server)`, `plugins/stamp.ts` | `stamp request`, after the application's own (`@1`) |
| a task | `server/tasks/orders/expire.ts` | entry `task orders:expire`, its handler `run`, which calls `expireOrders` |
| a task of a directory a module adds | `.../runtime/server/tasks/reports/daily.ts` | entry `task reports:daily` |
| a task run by its name | `runTask('orders:expire', { payload })` in `api/orders/expire.post.ts` | a producer joined to the task |
| a schedule | `nitro.scheduledTasks` in `nuxt.config.ts` | `cron 0 * * * *` -> `orders:expire`; `cron 0 3 * * *` -> `reports:daily`, and `db:backup`, which no task gives, is `reference-not-found` |
| a handler only development adds | `if (nuxt.options.dev) addServerHandler(...)` in `modules/reports/index.ts` | not served; note `framework-module-skipped` (`why: development`) |

Nothing is installed; `nuxt` and `element-plus` are declared.
