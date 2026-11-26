# svelte-components fixture

A SvelteKit application whose buttons are in `.svelte` components (P233). The
routes were read before (P38); the components holding the buttons were not,
so the routes they call read as never called. Here a click in a component
reaches the route it calls, in both Svelte 4's spelling and Svelte 5's.

| What | Where | What the graph says |
|---|---|---|
| Svelte 4 | `routes/+page.svelte`, `on:click={place}` | handles `place`, which requests `POST /api/orders` |
| Svelte 5 | `lib/OrderRow.svelte`, `onclick={() => orders.cancel(id)}` | handles `cancel` of `lib/orders.ts`, which requests `DELETE /api/orders/:param` |
| a child component (P255) | `<OrderRow id="1" />` in `routes/+page.svelte`, imported from `$lib/OrderRow.svelte` | `calls` from the page to `OrderRow` (`meta.renders`): the component whose click requests `DELETE /api/orders/:param` is part of the page |
| the route | `routes/api/orders/+server.ts`, `routes/api/orders/[id]/+server.ts` | entries `GET` and `POST /api/orders`, `DELETE /api/orders/:param` |

Nothing is installed; `@sveltejs/kit` and `svelte` are declared and that is
enough. The tsconfig is the one SvelteKit scaffolds: it extends
`.svelte-kit/tsconfig.json`, which `svelte-kit sync` writes and a fresh clone
does not have (P240).

| What | Where | What the graph says |
|---|---|---|
| `$lib` with no `.svelte-kit/` | `import { listOrders } from '$lib/api'` | `on:click={refresh}` reaches `GET /api/orders` |
| a `kit.alias` | `$orders` in `svelte.config.js` | `place` calls `lib/orders.ts:place` |
| a module of the framework | `import { goto } from '$app/navigation'` | no file, and no package named `$app` |
| what was read so | `tsconfig.json` | note `aliases-from-convention`, once |
