# svelte-components fixture

A SvelteKit application whose buttons are in `.svelte` components (P233). The
routes were read before (P38); the components holding the buttons were not,
so the routes they call read as never called. Here a click in a component
reaches the route it calls, in both Svelte 4's spelling and Svelte 5's.

| What | Where | What the graph says |
|---|---|---|
| Svelte 4 | `routes/+page.svelte`, `on:click={place}` | handles `place`, which requests `POST /api/orders` |
| Svelte 5 | `lib/OrderRow.svelte`, `onclick={() => orders.cancel(id)}` | handles `cancel` of `lib/orders.ts`, which requests `DELETE /api/orders/:param` |
| the route | `routes/api/orders/+server.ts`, `routes/api/orders/[id]/+server.ts` | entries `POST /api/orders`, `DELETE /api/orders/:param` |

Nothing is installed; `@sveltejs/kit` and `svelte` are declared and that is
enough. The tsconfig names `$lib` itself, as the one SvelteKit generates into
`.svelte-kit/` does; a fresh clone without that file resolves no `$lib`
import.
