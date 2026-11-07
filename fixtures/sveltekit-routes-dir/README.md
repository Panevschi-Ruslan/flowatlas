# sveltekit-routes-dir fixture

A SvelteKit application whose routes are not in `src/routes` (P251):
`svelte.config.js` moves them with `kit.files.routes: 'src/app'`. Before, the
reader looked in `src/routes` alone, so this application had no ways in and
no screens.

| What | Where | What the graph says |
|---|---|---|
| a route | `src/app/api/items/+server.ts` | entry `GET /api/items` |
| a page's server module | `src/app/items/[id]/+page.server.ts` | entry `GET /items/:param`, answered by `load` |
| a page | `src/app/+page.svelte` | a screen at `/`; `onclick={refresh}` reaches `GET /api/items` through `$lib/api` |
| a page beside its server module | `src/app/items/[id]/+page.svelte` | a screen at `/items/:param` |

Nothing is installed; `@sveltejs/kit` and `svelte` are declared and that is
enough. The tsconfig is the one SvelteKit scaffolds (P240).
