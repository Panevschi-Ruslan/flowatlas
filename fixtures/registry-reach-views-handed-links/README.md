# registry-reach-views-handed-links fixture

What P303 left open (P314): a store a module exports that other modules add
to, a registry reader handing back a view of its entries rather than the
entries themselves, and a link prop of another name every use hands a value.
Nothing is installed, as in a fresh clone.

## console (React Router 6): stores reached across modules, views of them

| Registry | Read as | Routes placed |
|---|---|---|
| `export const pages = new Map()`, `listPages()` handing back `[...pages.values()]`; `addPage` in another module sets it | `listPages()` | `Billing` at `/billing`, handed to `addPage` from a third module |
| the same store imported as `allPages`, `allPages.set('/team', {...})` outside any function | `listPages()` | `Team` at `/team` |
| `consolePanels()` handing back `panels.map((panel) => ({ ...panel, path: BASE + panel.path }))` | `consolePanels()` | `Usage` at `/console/usage`: the path the mapped object writes, the screen through its spread |
| `allReports()` handing back `Object.values(reports)` | `allReports()` | `Sales` at `/reports/sales` |
| a class's `static routes()` mapping `this.items` to `` { ...plugin, path: `/plugins${plugin.path}` } `` | `PluginRegistry.routes()` | `Calendar` at `/plugins/calendar` |
| `toolRoutes()` handing back `tools.map(toRoute)`, a function of its own | `toolRoutes()` | none: `Exporter` is not placed at `/export`, the entry is counted as not read, and `App`'s link to `/tools/export` says one route is written in a way not read |

## site (Next): a link prop handed values

| Written | What the graph says |
|---|---|
| `NavLink({ to })` rendering `` <Link href={`/${locale}${to}`}> ``, used as `LINKS.map((item) => <NavLink to={item.path}>)` and `<NavLink to={CAREERS}>`, never as text | `Menu` navigates to `[locale]/pricing`, `[locale]/about` and `[locale]/careers` through `NavLink`, one navigation per value read |
| `LocaleLink({ target })` rendering `` <Link href={`/${locale}${target}`}> ``, used once as `target={params.get('next')}` | a `navigation-unresolved` row at `Back`, where the value is handed; `LocaleLink` draws no navigation of its own |
| `` <Link href={`/tags/t-${name}`}> `` in `TagLink({ name })`, used as `name={tag.slug}` | `TagLink` itself navigates to `tags/[tag]`: the prop is glued into a segment and no use hands an address |
| `FOOTER.map((entry) => <Link href={entry.href}>)` over two entries with an address and one without | `Footer` navigates to `legal` and `status` |
