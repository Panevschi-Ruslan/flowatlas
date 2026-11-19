# composed-steps-props-factories fixture

What P326 left open (P333): a step over a view mapped already, an object a
`reduce` gathers read through `Object.values` or `Object.entries`, a registry
reached through a destructured parameter, a component's props or a factory
function, and a value a link of the application's own glues to a segment it
writes out whole, read as a query or a further segment from what its uses
hand. Nothing is installed, as in a fresh clone.

## console (React Router 6): steps one over another, receivers handed otherwise

| Written | Read as | Routes placed |
|---|---|---|
| `listAreas().map(...).flatMap((area) => [area, { ...area, path: `${area.path}/edit` }])` | the steps one after another | `Billing` at `/areas/billing`, `AreaEdit` at `/areas/billing/edit` |
| `listBoards().map(...).map(...)` | the same | `Kanban` at `/boards/kanban/view` |
| `Object.values(listTeams().reduce((all, team) => ({ ...all, [team.path]: { ... } }), {}))` | one object per team under a key, its values | `Members` at `/teams/members` |
| `Object.entries(listTasks().reduce((all, task) => { all[task.path] = { ... }; return all; }, {})).map(([, task]) => ({ ... }))` | the entry of each pair, mapped | `Backlog` at `/tasks/backlog/board` |
| `Object.values(GUIDES)`, an object written in place | its values | `Start` at `/guides/start` |
| `Object.entries(LOGS).map((pair) => ({ path: pair[1].path, ... }))` | not read | none: an info `route-entries-unread` row saying the pairs are not taken apart |
| `ShelfRegistry.routes()` handing back `this.items.map(...).flatMap(...)`; `shelves = makeShelves()`, a factory handing back a `new`; `<ShelfRoutes shelf={shelves} />` reading `props.shelf.routes()` | the reader's steps, the instance through the factory and the props | `Atlas` at `/shelves/atlas`, `AtlasPrint` at `/shelves/atlas/print`; `archive`'s entry not placed |
| `makeMenu()` handing back `{ add, list }` over a variable it keeps; `menu.add(...)`, `spare.add(...)` | the object per instance | `MenuHome` at `/menu/home`; `spare`'s entry not placed |
| `makeDesks()` handing back an object whose `list()` is `Object.values(this.items.reduce(..., {}))` | the reader's object, its values | `FrontDesk` at `/desks/front` |
| `<PanelRoutes registry={panels} />` taking `{ registry }` apart; `installPanel({ registry: panels }, ...)` and `installPanel({ registry: drafts }, ...)` | the instance through the prop and the parameter's key | `Usage` at `/panels/usage`; `drafts`' entry not placed |

## site (Next): a value glued to a wrapper's segment

| Written | What the graph says |
|---|---|
| `SearchLink({ query })` rendering `` <Link href={`/search${query}`}> ``, used once as `query={search.get('last')}` | a navigation from `Recent` to the search page, `query: guess`, heuristic; and the `navigation-unresolved` `dynamic` row naming ``/search${search.get('last')}`` beside it |
| `FindLink({ terms })` rendering `` <Link href={`/find${terms}`}> ``, used as `terms="?q=shoes"` and `terms={search.get('again')}` | both land at the finder page from `Footer`, firmly: a use hands a query, so the one not read is one too |
| `PortalLink({ href })` rendering `` <Link href={`/portal/${href}`}> ``, used as `href={search.get('to')}` | only the row, prefix `/portal/`: after a `/` the value is a further segment, though a page is at `/portal` |
