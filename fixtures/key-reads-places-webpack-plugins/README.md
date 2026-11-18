# key-reads-places-webpack-plugins fixture

What P344 and P345 left open (P351): a route or a link written straight over
`Object.keys(...)`, a route-level pattern nested deeper than one key, the
places of a list put together from lists whose order is known, an object an
adding function writes from what each call hands; an installed Strapi
plugin shipped as a webpack bundle, dependencies not installed that a key of
`config/plugins` names otherwise than their package, and an extension
writing the plugin's `controllers` object whole. Nothing is installed but the
two bundled plugins, as in a fresh clone.

## console (React Router 6)

| Written | Read as | Routes placed |
|---|---|---|
| `Object.keys(PAGES).map((path) => <Route path={path} element={PAGES[path]} />)`, `PAGES` an object of elements | the parameter the key, `PAGES[path]` the entry under it | `Home` at `/home`, `About` at `/about` |
| `Object.keys(TOOLS).map((name) => <Route path={`/tools/${name}`} element={TOOLS[name]} />)` | a template reading the key, read as written | `Importer` at `/tools/import` |
| `Object.keys(SHORTCUTS).map((to) => <Link to={to}>...)` | each key the address a link goes to | links to `Home` and `About` |
| `Object.entries(AREAS).map(([slug, { meta: { view: { Screen } } }]) => ...)`, `Object.entries(SECTIONS).map(([slug, { meta: { Screen } }]) => <Route path={'/sections/' + slug} ... />)`, `LINKS.map(({ to, view: { Screen } }) => ...)` | a pattern nested deeper than one key of the pair's entry or the list's item; a sum reading the key | `Pricing` at `/areas/pricing`, `Billing` at `/sections/billing`, `Team` at `/team` |
| `Object.entries(STEPS)`, `STEPS = [...FIRST, { Screen: Finish }]` | the spread list's places, then the next | `Welcome`, `Profile`, `Finish` at `/wizard/0`-`/wizard/2` |
| `Object.entries(STAGES)`, `STAGES = FIRST.concat([{ Screen: Review }])` | the concatenated list's places | `Welcome`, `Profile`, `Review` at `/stages/0`-`/stages/2` |
| `Object.entries(FLOW)`, `FLOW = [Welcome, Finish].map((Screen) => ({ Screen }))` | each object at its item's place | `Welcome` at `/flow/0`, `Finish` at `/flow/1` |
| `Object.entries(tourSteps())`, the function handing back a list written in place | the places of what it hands back | `Search` at `/tour/0`, `Support` at `/tour/1` |
| `Object.entries(LATE)`, `LATE = [{ Screen: Welcome }, ...remote]`, `remote` read at run time | the first place; past the spread, not known | `Welcome` at `/late/0`; an info `route-entries-unread` row saying the places past the spread are not known |
| `Catalog.add(name, Screen)` writing `this.departments[name] = { Screen, title: name }`, read back as `Object.entries(this.departments)`; `catalog.add('shoes', Shoes)`, `catalog.add('hats', Hats)` | one object per call, its parameters bound to the call's arguments, under the key the call hands | `Shoes` at `/catalog/shoes`, `Hats` at `/catalog/hats` |
| `addShelf(path, Screen)` writing `shelves.set(path, { Screen })` into a module's `Map`, read back as `[...shelves.entries()]` | the same, for a store kept by functions | `Scarves` at `/shelves/scarves` |

## cms (`type: "strapi"`)

| Declared | Entries |
|---|---|
| `strapi-plugin-pins`, installed, its `strapi-server.js` a webpack 5 bundle: `__webpack_modules__` keyed by path, an ES module's `__webpack_require__.d` default, a CommonJS module read through `__webpack_require__.n`, the entry inlined in the bootstrap writing `module.exports = __webpack_exports__` | `GET /api/pins/pins`, `DELETE /api/pins/pins/:id`, `PUT /pins/settings` (`handlerVia: 'package'`) |
| `strapi-plugin-maps`, installed, its `strapi-server.js` requiring a webpack 4 bundle: an array of modules handed to the bootstrap function, the entry loaded by `__webpack_require__.s = 1` | `GET /api/maps/maps` (`handlerVia: 'package'`) |
| `notes` resolving `./src/plugins/local-notes`, which `package.json` also lists as `@shop/strapi-plugin-notes: file:./src/plugins/local-notes`, not installed | `GET /api/notes/notes`; no row for the dependency |
| `color-kit` resolving the package `strapi-plugin-colors`, not installed | none; one `route-registry-unread` row under `color-kit` |
| `mapView`, the dependency `strapi-plugin-map-view` not installed | none; one row under `mapView` naming the dependency |
| `pdf-export`, no package of that name; `@studio/strapi-plugin-printer` not installed and named by no key | none; one row under `pdf-export` naming the dependency it may be |
| `boards`; its extension writes `plugin.controllers = { ...own, card: (opts) => ({ ...own.card, find }) }` and `Object.assign(plugin.controllers, { tag: {...} })` | `GET /api/boards/cards` and `GET /api/boards/tags` on the extension's actions; `POST /api/boards/cards` and `GET /api/boards/lanes` on the plugin's own |
| `polls`; its extension writes `plugin.controllers = { card: { find }, lane: plugin.controllers.lane }` | `GET /api/polls/cards` on the extension's, `GET /api/polls/lanes` on the plugin's; `POST /api/polls/cards` and `GET /api/polls/tags` unread, a `route-handler-unread` row each (the controller written whole without `create`, the controllers written without `tag`) |

## poller

Every call is joined to the cms at `localhost:4710`.
