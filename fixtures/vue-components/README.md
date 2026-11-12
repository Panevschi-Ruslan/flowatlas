# vue-components fixture

A Vue application whose screens are made of child components (P255): a tag
in a template is a `calls` edge from the component that writes it to the one
it names, so a screen's flow reaches what its children request.

| What | Where | What the graph says |
|---|---|---|
| an import of `<script setup>`, written in kebab-case | `<order-row>` in `views/OrdersView.vue` | `OrdersView` -> `OrderRow` (`meta.renders`) |
| `<component :is>` | `<component :is="OrderRow" />` | the same edge, drawn once |
| the Options API | `components: { RowActions }` in `OrderRow.vue` | `OrderRow` -> `RowActions`, whose click requests `POST /api/orders/:param/cancel` |
| a component registered for every template | `app.component('AppIcon', ...)`, `app.component('cart-summary', ...)` in `main.ts` | `App` and `OrdersView` -> `AppIcon`; `OrdersView` -> `CartSummary`, which requests `GET /api/cart` |
| the router's own | `<RouterView />` | nothing, and no row |
| a custom element | `<date-picker-element />` | nothing, and no row |
| a name nothing registers | `<ShippingNote />` | row `component-unresolved` |

The requests go to no service of this fixture, so each is a
`target-route-not-found` row.
