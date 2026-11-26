# registry-stores-address-props-vite fixture

What P296 and P297 left open (P303): a registry whose store is no field of a
class, a link of the application's own whose address prop is named apart from
the link's attribute, and full-stack frameworks run through Vite's dev server.
Nothing is installed, as in a fresh clone.

## docs (React Router 6): registries kept by functions

| Registry | Read as | Routes placed |
|---|---|---|
| a module's `Map`: `registerSection(section)` files by `section.area`, `sectionsOf(area)` reads `sections.get(area)` | `sectionsOf('docs')` | `Guides` at `/docs/guides`; `Billing` (filed under `account`) placed nowhere |
| a store handed in: `addEntry(store, entry)` pushes, `entriesIn(store, group)` keeps `store.filter((entry) => entry.group === group)` | `entriesIn(adminEntries, 'people')` | `Users` at `/admin/users`; `Reports` (another group) and `Archive` (added to `archiveEntries`) placed nowhere |
| an object's own field: `panels.add(panel)` pushes onto `this.items`, `panels.all()` hands it back | `panels.all()` | `Usage` at `/dashboard/usage` |

## handbook (Next): a link's address under another name

| Written | What the graph says |
|---|---|
| `<NavLink to="/pricing">`, `NavLink({ to })` rendering `` <Link href={`/${locale}${to}`}> `` | `Menu` navigates to `[locale]/pricing` through `NavLink`, and the link inside `NavLink` says nothing of its own |
| `` <Link href={`/orders/${id}`}> `` in `OrderLink({ id })` | `OrderLink` itself navigates to `orders/[id]`: the prop starts a segment |
| `` <Link href={`/tags/t-${name}`}> `` in `TagLink({ name })`, used as `<TagLink name="news" />` | `TagLink` itself navigates to `tags/[tag]`: its uses write a name, not an address |

`next dev` writes no port: Next's own 3000 (P296).

## store, planner and jobs: Vite's assumed port

`store` is Remix run by `remix vite:dev` and `planner` SvelteKit run by
`vite dev`; neither configuration nor script writes a port, so both listen on
Vite's 5173, `default: true`, `devServer: true`. `jobs` (Express, 4600) calls
both on that port:

| Request | Joined to |
|---|---|
| `GET http://localhost:5173/api/cart` | `store`'s resource route `GET /api/cart`, heuristic: of the two assumed on 5173, only `store` serves it (P300) |
| `GET http://localhost:5173/api/plans` | `planner`'s `GET /api/plans` (`+server.ts`), the same way |
| `GET http://localhost:5173/api/nothing` | nobody: neither serves it, so the assumed port places nothing |
