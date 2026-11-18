# keyed-stores-pair-patterns fixture

What P338 left open (P344): a registry's own keyed store, a pair's entry
taken apart by an object pattern, a list read as `[key, entry]` pairs, a
folded row's fourth place writing a value none of its samples writes, and a
receiver that may hold more than twelve instances. Nothing is installed, as
in a fresh clone.

## console (React Router 6)

| Written | Read as | Routes placed |
|---|---|---|
| `PageBook`: `this.pages[name] = entry` in `add`, `this.pages['home'] = entry` in `addHome`, the field written `{ overview: {...} }`; `routes()` hands back `Object.entries(this.pages).map(([name, page]) => ...)`; `book.add('billing', ...)`, `book.add(SETTINGS_KEY, ...)`, `book.addHome(...)` | each entry under the key its call writes: the argument, the key the method writes, the field's own | `Billing` at `/book/billing`, `Settings` at `/book/settings`, `Home` at `/book/home`, `Overview` at `/book/overview` |
| `PanelMap`: `this.panels.set(path, Screen)`, read back as `[...this.panels.entries()].map(([path, Screen]) => ...)` | a `Map`'s entries as pairs, the entry a value under its key | `Usage` at `/panels/usage` |
| `Toolbox`: `this.tools[name] = Screen`, read back as `Object.keys(this.tools).map((name) => ({ ..., Screen: this.tools[name] }))` | the keys, the entry looked up by each | `Exporter` at `/tools/export` |
| `AreaBook`: `this.areas[area] = entries`, `routesOf(area)` handing back `this.areas[area]`; `areaBook.put('admin', [...])`, `areaBook.put('public', [...])`, read as `areaBook.routesOf('admin')` | the list written under the area asked for | `Users` at `/admin/users`; `About` not placed |
| `Object.entries(SECTIONS).map(([slug, { Screen, base = '/docs' }]) => ({ path: `${base}/${slug}`, element: <Screen /> }))` | the entry taken apart, the default where the entry writes no `base` | `Guide` at `/docs/guide`, `Reference` at `/guides/reference` |
| `Object.entries(AREAS).map(([slug, { meta: { Screen } }]) => ...)` | a pattern nested in the entry's | `Pricing` at `/areas/pricing` |
| `LINKS.map(({ to, Screen }) => ({ path: to, Screen }))` | a list's item taken apart | `Help` at `/links/help` |
| `Object.entries(WIZARD).map(([step, Screen]) => ({ path: `/wizard/${step}`, Screen }))`, `WIZARD = [Welcome, Finish]` | each item under its place | `Welcome` at `/wizard/0`, `Finish` at `/wizard/1` |
| `<ShelfRoutes shelf={shelfNN} />` thirteen times, each shelf a `Shelf` instance given one page | the first twelve instances read, the thirteenth counted | `ShelfPage` at `/shelves/01` to `/shelves/12`; an info `route-entries-unread` row saying the receiver may hold 13 instances and the other 1 is not read |
| `EXTRA_A` to `EXTRA_D`, each a list of an entry a function makes | not read, one `route-entries-unread` row each | none; the five rows fold into one whose `meta.causes` lists three samples with their own `list`, and under `differing` each value the two places past them write, the shelves' `why` among them |
