# vue-plugins fixture

A Vue application whose templates use components a plugin registers and
components loaded later (P258).

| What | Where | What the graph says |
|---|---|---|
| a library a plugin installs | `app.use(vuetify)` in `main.ts`; `<VApp>`, `<v-main>`, `<VCard>` | the library's: no edge and no row |
| a library's component registered by name | `app.component('Button', Button)` from `primevue/button`; `<Button>` | the library's |
| a library by its names | `primevue` is declared; `<DataTable>` | the library's |
| a plugin of the repository | `install(app) { app.component('AppBadge', AppBadge) }` in `plugins/badges.ts` | `OrdersView` -> `AppBadge` |
| `defineAsyncComponent` held in a name | `const OrderTable = defineAsyncComponent(() => import(...))` in `OrdersView.vue` | `OrdersView` -> `OrderTable` |
| one registered for every template | `app.component('OrderChart', defineAsyncComponent(...))` | `OrdersView` -> `OrderChart` |
| the Options API with a loader | `components: { ChartLegend: defineAsyncComponent({ loader }) }` | `OrderChart` -> `ChartLegend` |
| a plugin of a package the table does not know | `app.use(UiKit)`; `<KitPanel>` | row `component-unresolved`, saying `app.use(UiKit) in src/main.ts may register it` |

The requests go to no service of this fixture, so each is a
`target-route-not-found` row.
