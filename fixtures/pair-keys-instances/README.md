# pair-keys-instances fixture

What P333 left open (P338): the key of a `[key, entry]` pair, an entry
handed in the object a registry is handed in, a receiver that may hold
several instances, and an instance made where it is read. Nothing is
installed, as in a fresh clone.

## console (React Router 6)

| Written | Read as | Routes placed |
|---|---|---|
| `Object.entries(SCREENS).map(([path, Screen]) => <Route path={path} element={<Screen />} />)`, `SCREENS = { '/reports': Reports, '/inbox': Inbox }` | each pair's key the address, its entry the screen | `Reports` at `/reports`, `Inbox` at `/inbox` |
| `Nav` rendering `<Link to={path}>` over `Object.entries(SCREENS).map(([path]) => ...)` | a link per key | navigations from `Nav` to both |
| `Object.entries(TOOLS).map(([path, { Screen }]) => <Route ... />)` | a key of the pair's entry | `Export` at `/tools/export` |
| `Object.entries(PAGES).map(([slug, page]) => ({ ...page, path: `/pages/${slug}` }))` | the key bound in the step | `Intro` at `/pages/intro`, `Faq` at `/pages/faq` |
| `Object.entries(listTeams().reduce((all, team) => ({ ...all, [team.slug]: team }), {})).map(([slug, team]) => ...)` | the key the reduce writes each team under | `Members` at `/teams/members` |
| `install({ registry: widgets, widget: {...} })`, `install({ registry: gadgets, ... })`, `install({ registry: spares, ... })`; `<WidgetRoutes registry={widgets} />` and `<WidgetRoutes registry={gadgets} />` | the entry beside the store; both instances the prop is handed | `Chart` at `/widgets/chart`, `Gauge` at `/gadgets/gauge`; `spares`' entry not placed |
| `makeShelf().routes()`, the class starting every instance with `/shelf/home`; `other = makeShelf()` added to | an instance made afresh in place: only what its class writes | `ShelfHome` at `/shelf/home`; `other`'s entry not placed |
| `makeBin().routes()`, a class starting empty | the same | none: an info `route-entries-unread` row whose `meta.notes` says the instance is made where it is read |
| `getDock()` handing back `dock ??= new DockRegistry()`; `getDock().add(...)` | the one instance every call hands back | `DockMain` at `/dock/main` |
