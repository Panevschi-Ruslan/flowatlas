# registry-fields-caller-views fixture

What P314 left open (P320): a store a class keeps in a static field that other
modules add to, a registry's adding function written as a method of another
module's class, a view the caller makes of a reader's entries before the route
list maps them, a link of the application's own that puts a segment in front of
a value no use hands as text, and a row of its own for a route list's entries
not read. Nothing is installed, as in a fresh clone.

## console (React Router 6): class fields, class methods, caller views

| Written | Read as | Routes placed |
|---|---|---|
| `static items` of `WidgetRegistry`, its `static routes()` mapping each to `` { ...widget, path: `/widgets${widget.path}` } ``; `WidgetRegistry.items.push({...})` in another module outside any function | `WidgetRegistry.routes()` | `Clock` at `/widgets/clock` |
| the same field pushed onto by `addWidget`, a function of a third module, called from a fourth | `WidgetRegistry.routes()` | `Weather` at `/widgets/weather` |
| `static entries = new Map()` of `Shelf`, a class with no methods; `shelfPages()` reads `Shelf.entries` by name; `Shelf.entries.set(...)` in another module | `shelfPages()` | `Archive` at `/archive` |
| `sections`, a module's array, added to by `SectionCatalog.register` (a static method of another module's class) and `book.add` (an instance's method, through `this.keep`) | `listSections()` | `Inbox` at `/inbox`, `Outbox` at `/outbox` |
| `const pages = listPages().filter(...).map((page) => ({ ...page, path: `/app${page.path}` }))`, then `pages.map(... <Route>)` | the caller's view | `Home` at `/app/home`, `Drafts` at `/app/drafts` |
| `const tools = listTools().map(toRoute)`, a function of its own | not read | none: an info `route-entries-unread` row at the route, one entry not read and why, and `App`'s link to `/tools/export` lands nowhere |

## site (Next): a wrapper's segment in front of a value not read

| Written | What the graph says |
|---|---|
| `AppLink({ to })` rendering `` <Link href={`/app${to}`}> ``, used once as `to={search.get('from')}` | `AppLink` draws no navigation of its own; a `navigation-unresolved` `dynamic` row at `Resume`, where the value is handed, says it navigates to ``/app${search.get('from')}``, its `prefix` `/app` |
