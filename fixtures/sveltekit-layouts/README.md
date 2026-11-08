# sveltekit-layouts fixture

A SvelteKit application whose pages are wrapped by layouts up the route
tree, each with a `load` of its own (P258). A page's flow goes through every
layout that wraps it, in the order SvelteKit runs them: every server `load`
first, root first, then every universal one, then each layout's component,
the root's outermost. Each is a `calls` edge from the page with `meta.order`.

| What | Where | What the graph says |
|---|---|---|
| the root layout's server load | `routes/+layout.server.ts`, `readSession()` | `@0` from every page; it is also the handler of `GET /` (layout), so the page reaches the server half |
| a group's universal load | `routes/(app)/+layout.ts`, `listMenu()` | `@1` from `orders/[id]` |
| a page's own load | `routes/(app)/orders/[id]/+page.ts` | `@2`, after its layouts' |
| the layouts' components | `routes/+layout.svelte` (its button signs out), `routes/(app)/+layout.svelte` | `@3`, `@4` |
| a page that resets to the root | `orders/[id]/receipt/+page@.svelte` | the root's load and layout only; it is still the page at `/orders/:param/receipt` |
| a layout that resets to the root | `(app)/print/+layout@.svelte` | `print/+page` goes through the root's layout and its own, not `(app)`'s |
| a reset naming no directory above | `(app)/broken/+page@(shop).svelte` | row `layout-unresolved` (`missing`) |

Nothing is installed; `@sveltejs/kit` and `svelte` are declared.
