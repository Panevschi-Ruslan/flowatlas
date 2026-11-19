# caller-steps-handed-instances fixture

What P320 left open (P326): a view the caller makes of a list through
`flatMap`, `Array.from(list, fn)` or a `reduce`; an instance's registry field
reached through a parameter it is handed, a field of another class given it
when made, or an import; and a link of the application's own whose prop of any
name it puts into its link's address after a segment written out whole.
Nothing is installed, as in a fresh clone.

## console (React Router 6): steps of a caller's view, instances reached otherwise

| Written | Read as | Routes placed |
|---|---|---|
| `listAreas().flatMap((area) => ({ ...area, path: `/areas${area.path}` }))` | one object per area | `Billing` at `/areas/billing` |
| `listReports().flatMap((report) => [{ ... }, { ..., path: `/reports${report.path}/edit` }])` | two objects per report | `Invoices` at `/reports/invoices`, `InvoicesEdit` at `/reports/invoices/edit` |
| `Array.from(listBoards(), (board) => ({ ... }))` | one object per board | `Kanban` at `/boards/kanban` |
| `listTeams().reduce((all, team) => [...all, { ... }], [])` | one object per team | `Members` at `/teams/members` |
| `listTasks().reduce((all, task) => { all.push({ ... }); return all; }, [])` | one object per task | `Backlog` at `/tasks/backlog` |
| `listGuides().flatMap((guide) => (guide.path === '' ? [] : [guide]))` | the guide as it is, or none | `Guides` at `/guides` |
| `listLogs().reduce((all, log) => all.concat(toLogRoute(log)), [])`, a function of its own | not read | none: an info `route-entries-unread` row at the route saying the reduce is not read, and `App`'s link to `/logs/audit` lands nowhere |
| `panels`, an exported `new PanelRegistry()` whose `routes()` flat-maps `this.items`; `panels.items.push(...)` in another module | the instance through its import | `Stats` at `/panels/stats` |
| `installPanel(registry, panel)` pushing onto `registry.items`, called with `panels` and with `drafts` | the instance handed through the parameter | `Usage` at `/panels/usage`; `drafts`' entry not placed |
| `new PanelBook(panels)` keeping it as a parameter property, `book.add(...)` pushing onto `this.registry.items`; `new PanelBook(drafts)` adding too | the instance through the other class's field, per instance | `Alerts` at `/panels/alerts`; the drafts book's entry not placed |
| `new PanelShelf(panels)` writing `this.registry` in its constructor, `shelf.put(...)` through `this.keep(...)` | the same | `Limits` at `/panels/limits` |

## site (Next): a wrapper's prop of any name after a written segment

| Written | What the graph says |
|---|---|
| `AreaLink({ path })` rendering `` <Link href={`/area${path}`}> ``, used once as `path={search.get('next')}` | no navigation of its own; a `navigation-unresolved` `dynamic` row at `Return` naming ``/area${search.get('next')}``, prefix `/area` |
| `ConsoleLink(props)` writing `` const address = `/console${props.target}` `` and rendering `<Link href={address}>`, used once as `target={search.get('back')}` | no navigation of its own; the same row at `Back` naming ``/console${search.get('back')}``, prefix `/console` (folded with the one above) |
