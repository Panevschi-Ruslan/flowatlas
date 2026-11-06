# vue-spa fixture

A Vue single-page application and the NestJS service it calls, in two
repositories (P233). The point of it: a click in a `.vue` component reaches the
route in the other repository, with every position naming the component file
at its own line.

Shapes taken from the Vue documentation's own examples - `<script setup>`, the
Options API, a composable, a Pinia store, Vue Router with lazy routes - and
from the axios client every Vue starter writes.

| What | Where | What the graph says |
|---|---|---|
| `<script setup>` handler | `views/OrdersView.vue`, `@click="refresh"` | `ui_action` handles `refresh`, which calls the composable, which requests `GET /orders` |
| a Pinia action from the template | `@click="orders.add(name)"` | `ui_action` handles `useOrdersStore.add`, which requests `POST /orders` |
| Options API method | `views/OrderDetail.vue`, `@click="cancel"` | `ui_action` handles `OrderDetail.cancel`, which requests `POST /orders/:param/cancel` |
| a handler the component does not have | `@click="archive"` | row `template-handler-not-found` |
| Vue Router, lazy and nested | `router/index.ts` | `OrdersView` at `/orders`, `OrderDetail` at `/orders/:id` |
| `@/` from the solution tsconfig's project | `tsconfig.json` refers to `tsconfig.app.json`, which names `@/*` | `router/index.ts` imports `@/views/OrdersView.vue` (P240) |
| an alias only Vite names | `#api` in `vite.config.ts` | the store's `api.post` is the client of `src/api/client.ts`, which requests `POST /orders` (P240) |
| what was read so | `tsconfig.json` | note `aliases-from-config`, once, naming both |

The tsconfigs are the ones `create-vue` scaffolds: a solution `tsconfig.json`
with `files: []` and references to `tsconfig.app.json` and `tsconfig.node.json`.

`web/node_modules` holds a hand-written stub for `axios`; Vue, Pinia and Vue
Router are not installed, and nothing needs them to be.
