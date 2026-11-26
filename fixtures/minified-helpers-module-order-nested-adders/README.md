# minified-helpers-module-order-nested-adders fixture

What P344, P345 and P351 left open (P355): a minified bundle renaming a
bundler's helpers, a list added to across modules and read as `[place, item]`
pairs, and an object an adding function writes reached through other adding
functions handing it their own parameters. Nothing is installed but the four
bundled plugins, as in a fresh clone.

## console (React Router 6)

Two entry points: `main.tsx` imports `features/register.ts` (which imports
`billing`, `intro` - itself importing `profile` first - `mail` - itself
importing `outbox` first - `tour-start` and `clock`, in that order), then
`App`; `admin.tsx` imports `features/weather.ts`, then `App`. `App` loads
`features/tour-late.ts` only through `import()`.

| Written | Read as | Routes placed |
|---|---|---|
| `StepBook`: `items = [{ Screen: Welcome }]`, `add(step) { this.items.push(step) }`, read back as `[...this.items.entries()].map(([at, step]) => ...)`; `steps.add(...)` at the top of `billing`, `profile`, `intro` | the item written in place first, then each added in the order the modules are evaluated: `profile` before `intro`, whose import of it runs first | `Welcome` at `/steps/0`, `Billing` at `/steps/1`, `Profile` at `/steps/2`, `Intro` at `/steps/3` |
| `export const panels = []`, `panels.push(...)` at the top of `outbox` and `mail` (two items in one call), read as `Object.entries(panels)` | the items pushed, in the order the modules are evaluated and, in one call, as written | `Outbox` at `/panels/0`, `Inbox` at `/panels/1`, `Archive` at `/panels/2` |
| `addTour(...)` at the top of `tour-start` and of `tour-late`, a module only `import()` loads; read as `[...tourList.entries()]` | the places not known | none; an info `route-entries-unread` row saying `tour-late.ts` is loaded only by a dynamic `import()` |
| `addWidget(...)` at the top of `clock` (under `main.tsx`) and `weather` (under `admin.tsx`) | the places not known | none; the row (folded into the one above) saying the modules adding to it are reached from 2 entry points |
| `Catalog.add(name, Screen)` writing `this.departments[name] = { Screen, title: name }`; `addHome(Screen) { this.add('home', Screen) }`, `addSection(slug, Screen) { this.add(slug, Screen) }`, `addSale(Screen) { this.addSection('sale', Screen) }` | the object `add` writes, its parameters bound through each call handing them on, at the outer call | `Shoes` at `/catalog/shoes`, `Home` at `/catalog/home`, `Hats` at `/catalog/hats`, `Sale` at `/catalog/sale` |

## cms (`type: "strapi"`)

| Declared | Entries |
|---|---|
| `strapi-plugin-badges`, its `strapi-server.js` an esbuild bundle minified: `__commonJS`, `__export`, `__toESM` and `__toCommonJS` renamed to one letter each | `GET /api/badges/badges`, `POST /api/badges/badges` (`handlerVia: 'package'`) |
| `strapi-plugin-ribbons`, a rolldown bundle minified: `__commonJSMin` and `__toESM` renamed, handed the factory in parentheses | `GET /api/ribbons/ribbons` |
| `strapi-plugin-stamps`, a webpack 5 bundle minified: `__webpack_require__` renamed `r` - its factories handed it as their third parameter, its `.d` and `.n` kept - the bootstrap's statements joined by commas | `GET /api/stamps/stamps`, `DELETE /api/stamps/stamps/:id`, `PUT /stamps/settings` |
| `strapi-plugin-seals`, a bundle whose loader is of no shape known (`function q(k) { return m[k]() }`) | none; one `route-registry-unread` row |

## poller

Every call is joined to the cms at `localhost:4720` but the one to the seals
plugin, whose routes are not read.
