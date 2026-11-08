# nuxt-startup-names fixture

A Nuxt application whose root component adds route middleware when it is set
up, whose components come from libraries a module installs - one under a
prefix a layer sets - and whose server has a task the build does not register,
because Nitro's tasks flag is off (P262).

## The application

| What | Where | What the graph says |
|---|---|---|
| a named middleware the root component adds | `addRouteMiddleware('tenant', ...)` in `app/app.vue`'s `<script setup>` | `pages/index` names it: an edge `@1` with `meta.setup: app/app.vue`, `meta.addedIn: app/app.vue`, `meta.firstNavigation: false`; it requests `GET /api/tenant` |
| a global one a composable adds, called by that setup | `useVisitGuard()` in `app.vue`, `addRouteMiddleware(fn)` in `composables/useVisitGuard.ts` | `@0` from every page, `meta.addedIn: app/composables/useVisitGuard.ts`; it requests `POST /api/visits` |
| one a handler adds | `useLateGuard()` in `pages/index.vue`'s `arm`, `addRouteMiddleware('late', ..., { global: true })` | no edge; row `route-middleware-unresolved` (`why: scoped`) at the call, and at `pages/index`, which names `late` |
| one a component's setup adds | `addRouteMiddleware('promo-seen', ...)` in `components/PromoBanner.vue` | no edge; the same row at the call |
| Nuxt UI, by its module | `modules: ['@nuxt/ui']`, `@nuxt/ui` declared; `<UApp>`, `<UButton>`, `<UCard>`, `<UAlert>` | the library's: no edge and no row |
| PrimeVue, installed by a layer's module, under the prefix the layer sets | `../brand`: `modules: ['@primevue/nuxt-module']`, `primevue.components.prefix: 'Prime'`; `<PrimeDataTable>`, `<PrimeButton>` | the library's: no edge and no row; the shop's manifest declares neither |
| PrimeVue's own name without the prefix | `<Button>` in `pages/carts.vue` | `component-unresolved` |

## The server

| What | Where | What the graph says |
|---|---|---|
| a task | `server/tasks/carts/prune.ts` | entry `task carts:prune`, `meta.enabled: false` |
| a schedule | `nitro.scheduledTasks` in `nuxt.config.ts` | `cron 0 4 * * *` -> `carts:prune`, `meta.enabled: false` |
| the flag | `nitro.experimental.tasks` not set, `nuxt` 4 (Nitro 2) | note `framework-feature-off` at `nuxt.config.ts`: the build registers none of them |
| a task run by its name | `runTask('carts:prune')` in `server/api/carts/prune.post.ts` | a producer joined to the task |

The `framework-module-installed` note names both libraries' modules with what
they add. Nothing is installed; the manifests declare `nuxt`, `@nuxt/ui` and,
in the layer, `primevue` and `@primevue/nuxt-module`.
