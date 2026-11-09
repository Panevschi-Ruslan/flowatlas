# Command reference

Every command, every flag, and what each one does. For what the tool is and why,
see the [README](../README.md).

Commands fall into four groups. **Setting up** writes the configuration and
registers the graph server. **Building** reads the repositories. **Asking** reads
the built graph and never touches a repository. **Checking** says what could not
be read, what is accepted, what a branch changes, and whether the docs that
describe a flow still say what the graph says.

Two flags appear almost everywhere and mean the same thing every time:

| Flag | Meaning |
|---|---|
| `--config <path>` | the configuration file, or a directory to find one from. Defaults to searching upward from where you are |
| `--db <path>` | the database to read. Defaults to `<output>/graph.db` from the configuration |

Exit codes are the same across every command: `0` answered, `1` the answer is no
or which-one-did-you-mean, `2` could not run at all. "Could not run" includes a
question asked of a graph nobody could report on: `doctor` answers 2 over a
graph a failed build wrote, an empty one, one a service contributed nothing to,
and one where most of a service's ways in were read no further than their
addresses. [`doctor`](#flowatlas-doctor) says why for each.

---

## Setting up

### `flowatlas link <repo...>`

Puts repositories into one project. Each argument is a path to a repository
root, the directory holding its `package.json`. Creates `flowatlas.config.json` if
there is none, and adds to it if there is.

Each repository's name and kind come from its manifest. Two repositories sharing
a package name are told apart by their directory. A repository already in the
project is reported, never duplicated.

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | `./flowatlas.config.json` | where to write the configuration |
| `--no-mcp` | off | skip registering the graph server in each repository |
| `--dry-run` | off | say what would change and change nothing |
| `--suggested` | off | instead of paths, link the directory that fits each repository `doctor --missing` names (below); prints what it found first |
| `--scan <dir>` | none | with `--suggested`: also look in this directory, one level down; repeatable |
| `--db <path>` | the configured one | with `--suggested`: the graph the suggestion is read from |

```sh
flowatlas link ../admin-api ../bot ../web
flowatlas link ../new-service --dry-run
flowatlas link --suggested --dry-run
```

**`--suggested`.** Runs `doctor --missing` over the built graph, prints it, and
links the one directory that fits each repository it names, as `link <path>`
would. Where two directories fit one name, neither is linked: the line says so,
and the person names the path or narrows the search with `--scan`. With
`--dry-run` nothing is written. Rebuild afterwards: the joins are made by the
next `build`, never by the suggestion.

### `flowatlas unlink <name...>`

Takes services out of the project by name, and removes only the flowatlas entry
from each one's `.mcp.json`, leaving any other servers alone.

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | `./flowatlas.config.json` | which project |
| `--dry-run` | off | say what would change and change nothing |

### `flowatlas init`

The zero-argument alternative to `link`: looks for repositories beside where the
configuration will go and asks which belong to the project. It looks one level
down from `--dir`, at each directory with a `package.json`.

**A workspace is several services, and `init` proposes each.** A repository that
declares one, through `workspaces` in its manifest or a `pnpm-workspace.yaml`, is
read as the services it holds: one per member that looks like an application,
and none for the packages those applications import, because a package is read
as part of whichever service declares it. A member whose own manifest declares
nothing takes the workspace root's manifest for the question of what it is, which
is the ordinary shape of a server whose dependencies are kept at the root. A
repository that declares no workspace, and a workspace with no application in it,
are one service. `fixtures/next-monorepo` is a workspace with one application in
`apps/web` and its handler bodies in `packages/`, and `init` pointed at the
directory holding it proposes `web` and nothing else. Point `--dir` at the
directory the repository sits in, not at the workspace root itself: `init` looks
one level below `--dir`, so from inside a root whose members are two levels down,
as `apps/web` is, it finds nothing.

| Flag | Default | Does |
|---|---|---|
| `--dir <path>` | the parent of the output | where to look for repositories |
| `--out <file>` | `./flowatlas.config.json` | where to write the configuration |
| `-y, --yes` | off | accept every suggestion without asking. Required when the terminal is not interactive |
| `--force` | off | overwrite an existing configuration |
| `--list-unknown` | off | name every repository nothing reads, however many there are |
| `--no-mcp` | off | skip registering the graph server |

Each `repo` is written relative to the configuration, so the project still loads
from another checkout — unless getting there climbs all the way to the root of
the file system, which is what a configuration written far from its repositories
does (`--out` in one tree, `--dir` in another). That one is written absolute,
rather than as `../../../../../../../Users/…`. `link` writes paths the same way.

**Many repositories nothing reads are counted, not listed.** Up to five are named
as below. Past that, `init` lists the services it will read, then counts the
rest: how many were recognised as a stack there is no reader for, by stack, and
how many it could not type at all, with what those have in common — how many
declare no dependency, are libraries, declare a workspace with no application in
it, or have no `tsconfig.json`, and the dependencies they declare most. Each is
still in the configuration, as `unknown`; `--list-unknown` names every one.

```
Wrote /work/flowatlas/flowatlas.config.json with 103 service(s):
  api  ../api  nestjs
  web  ../web  angular
  and 101 that nothing here reads:
No reader yet for 13 repositories: Astro (9), the Serverless Framework (4).
flowatlas reads repositories of type nestjs and … and react today.
Those repositories stay in the configuration and contribute nothing to the graph.
Could not tell the type of 88 repositories. Of those:
  88 have no tsconfig.json, so may hold no TypeScript at all
  61 declare no dependency at all
  the dependencies they declare most: lodash (22), axios (19), dayjs (12)
Detection is only a suggestion. Set the type by hand if you know it.
Run init again with --list-unknown to name every one; each is in the configuration with its type.
```

The type of a repository is read from its manifest: `@nestjs/core` makes it
`nestjs`, `@medusajs/framework` or `@medusajs/medusa` makes it `medusa`, `next`
makes it `nextjs`, `@sveltejs/kit` makes it `sveltekit`, `@remix-run/node` or
`@remix-run/react` makes it `remix`, `@react-router/dev` makes it `react-router`,
`nuxt` makes it `nuxt`, `express`, `fastify` and `koa` make it each of those,
`@angular/core` makes it `angular`, `react` makes it `react`, `vue` makes it `vue`,
`svelte` makes it `svelte`, and anything else is
written as `unknown`. Those fourteen are every type there is. Hono and Telegraf have
no type of their own: they are frameworks the server reader finds inside a
repository whichever server type it is given, so a repository whose only
framework is Hono is
given any of the server types — `express` will do — and its routes are read. Where
the manifest names a framework there is no reader for — Astro or Solid —
`init` says so by name, and `build` repeats it on that repository's line:

```
web            skipped (no-extractor: Astro, no reader yet)
```

Where the manifest declares a framework it *can* read, the line says which type
to set instead, because a `type` the tool does not know — a typo, or a value
from before a reader existed — reads exactly like a repository with no reader:

```
api            skipped (no-extractor: looks like nestjs; set its type to "nestjs")
```

The repository stays in the configuration and contributes nothing to the graph.
Everything else in the project is still read and still joined; what is missing
is that repository's routes, calls and types. NestJS wins over Express in a
repository that declares both, since `@nestjs/platform-express` brings Express
with it and the Nest reader knows more about such a repository than the Express
one would.

**A repository that is a server and a browser in one directory declares the
server.** Set `type` to `nestjs`, `express`, `fastify`, `koa` or `nextjs` — not to
`react` or `angular` — and the browser half is read as well: that reader opens
every kind of TypeScript source and hands the screens, the actions and the
requests to whichever frontend adapter recognises the manifest, so one reading
produces both halves and joins the requests to the routes that answer them. The
reverse does not hold. `react` and `angular` are for a repository that is only a
browser; asked of a full-stack one they read the screens and leave the data
layer, the brokers, the wrapping chain and the contract types on the floor.

This is what `init` and `link` suggest, so accepting the suggestion is enough,
and a repository that declares both halves is told why:

```
web            skipped (no-extractor: looks like koa; set its type to "koa"
               (it declares react as well, and the koa reader reads both halves))
```

For `express`, `fastify` and `koa`, and for Hono inside any server repository,
what is read is the route as the code registers it — the verb, the path, the
handler, the router it is declared on and the prefix that router is mounted
under, however many mounts deep — together with the middleware in front of it,
including middleware installed on an application above the mount and inherited
through it. That is what makes the route audit answer on these repositories
rather than defer to a person. The shapes that registration is really written in
are read too, each held by a fixture:

- an application declared by a chain, `express().disable('x-powered-by')`, which
  is still that application (`fixtures/express-chained-app`);
- a list of paths, `get(['/items/:id', '/i/:id'], handler)`, which is one way in
  per path, written in place or named elsewhere (`fixtures/express-path-array`);
- a mount through a published helper, `app.use(mount('/api', api))` from
  `koa-mount`, with or without the prefix (`fixtures/koa-mount-helper`). A helper
  the repository wrote itself cannot be described, so a route under one is a row
  naming the call the path is inside;
- one mount over a collection of applications that plugins add themselves to,
  followed back to the calls that fill the collection
  (`fixtures/koa-plugin-registry`). A collection a package publishes cannot be
  enumerated, and is one row naming the collection and the mount;
- a named handler handed to a wrapper the repository declares,
  `asyncMiddleware(getVideo)`, whose handler is `getVideo`, and a factory called
  with values, `rateFactory('like')`, whose handler is what the factory builds
  (`fixtures/express-wrapped-handler`). A factory handed a function, or a wrapper
  handed a list, keeps no handler and says so, because it cannot be told from one
  more wrapper;
- a handler handed to a wrapper after a name or options, or before options —
  `withSpan('getLoan', getLoan)`, `traced({ name: 'createLoan' }, async (req, res)
  => …)`, `instrument(returnLoan, { segment: 'returns' })` — inline or through a
  `const`, which lands on the handler like any other wrapper
  (`fixtures/express-traced-handlers`). The rule for what a wrapper is, is the
  one the Lambda reader follows a handler by too; see
  [Functions and routes declared in Terraform](#functions-and-routes-declared-in-terraform);
- an application in a repository whose dependencies are not installed, where the
  framework's types resolve to nothing. The source still says what the value is —
  `import express from 'express'` and `const app = express()` — so the
  application is recognised from that, and every route read off it carries
  `heuristic` confidence, because it rests on what the author wrote rather than
  on what a compiler checked (`fixtures/express-not-installed`).

A path assembled at run time is reported rather than placed at a guessed
address. A route under a mount whose path could not be read has a row of its own,
`route-mount-unread`, and a reading that placed some routes and not the rest says
how many in `entry-http-routes-unplaced`, so a partial read never looks like a
repository with fewer routes.

**Vue, Nuxt and Svelte (P233).** A component written in a file of its own
format is read through its scripts. Each `.vue` or `.svelte` file is handed to
the checker as a TypeScript file beside it holding its `<script>` blocks where
they are, everything else turned to spaces, so every line and column is the
component's own and every id, position and row names the component file; an
import of `./X.vue` resolves to it, so a component's functions are followed
like any module's. A component is a `ui_component` whose code is its whole
script: what `<script setup>` does when the component is shown - a
`useFetch`, a store it reads, a composable it calls - is the component's, and
each function the script declares is a function of its own.

The markup's event bindings are its clicks: `@click="save"`,
`v-on:submit.prevent="send(form)"`, `@custom-event="…"`, Svelte 4's
`on:click={save}`, Svelte 5's `onclick={save}` and `{onclick}`. Each is a
`ui_action` at the binding, with a `handles` edge to what it runs: a function
of the script or one it imports, a method of the Options API (`methods`, or a
function its `setup()` returns), an action of a store the script holds
(`orders.add(id)`), every call of a handler written as statements. A binding
that only assigns runs the component; one naming a function the component
does not have is a row, `template-handler-not-found`. Bindings that fire while
a person types - `@input`, `@change`, `@keyup` - are not ways in, nor are
`v-model`, `bind:` or a displayed value.

A Pinia store (`defineStore` with `actions`, or a setup function whose returned
functions are its actions) and a Vuex store (`createStore` with `actions` and
namespaced `modules`) have their actions as functions, and a call to one -
`orders.add()` on the store a `useOrders()` returned, `dispatch('orders/add')`
- is drawn without the library installed. A call to what a composable handed
back (`const { load } = useOrders(); load()`) is a call into the composable.
Requests are read as the React reader reads them, with Nuxt's `$fetch`,
`ofetch`, `useFetch` and `useLazyFetch` beside `fetch` and axios.

Vue Router's routes - an object with a `path` and a `component`, under a
parent's `children`, the component imported or `() => import('./X.vue')` -
make a component a screen at that address, as do Nuxt's `pages/` (`[id].vue`
is `:id`, `index` the folder's own, a `(group)` nothing) and SvelteKit's
`+page.svelte`. Nuxt's server is Nitro's: a file under `server/api` answers
under `/api` and one under `server/routes` at the root, with the verb from its
name (`orders.get.ts`, `[id].delete.ts`) or every verb without one; its
handler is the function handed to `defineEventHandler`, what it reads is read
off `readBody`, `readValidatedBody`, `getQuery` and `getRouterParam` whether
imported from `h3` or global as Nuxt makes them, `throw createError({
statusCode })` is a failure of that status, and every file under
`server/middleware` stands in front of every route. A Nuxt application is
both halves of one service (type `nuxt`): a page's `$fetch('/api/orders')`
joins to its own `server/api/orders.get.ts`. Neither framework needs to be
installed (`fixtures/vue-spa`, `fixtures/nuxt-full-stack`,
`fixtures/svelte-components`).

**Aliases and imports a framework generates (P240).** Nuxt and SvelteKit name
their aliases for the compiler in a tsconfig they write on `nuxi prepare` and
`svelte-kit sync` - `.nuxt/tsconfig.json`, `.svelte-kit/tsconfig.json` - and
no repository commits it. Where that file is not there, the aliases are read
as each framework documents them, so an import through one resolves as it
would after the framework ran:

| Framework | Aliases | Read from the configuration, when written as literals |
|---|---|---|
| Nuxt 3 | `~` and `@` the root, `~~` and `@@` the root, `#shared`, `#app` | `srcDir`, `serverDir`, `alias` |
| Nuxt 4 (or `future.compatibilityVersion: 4`) | `~` and `@` `app/` (the root without one), `~~` and `@@` the root, the server beside `app/` | the same |
| SvelteKit | `$lib` to `src/lib` where it is there | `kit.files.lib`, `kit.alias` |

Nuxt also imports some names for a file that uses them with no import line,
and those are read as imports of the files that export them: in the
application, what `composables/`, `utils/`, `@pinia/nuxt`'s `stores/` and
`imports.dirs` export (top-level files and each folder's `index`, a default
export by its file's name in camel case), and `shared/utils` from Nuxt 4; on
the server, what `server/utils/` exports, and `shared/utils`. A name only a
template names is imported too, so `@click="clearBasket"` reaches
`utils/basket.ts`. The import is added after the file's last line, so no
position moves, and only where the file does not declare or import the name
itself; `#imports` is a module of the same names. `imports.autoImport: false`
turns it off. A name two of those files export is joined to neither, and is a
row (`implicit-import-ambiguous`).

What the repository says itself always wins. A `paths` key the tsconfig names
is never replaced, and where the generated tsconfig is there its aliases are
the ones read. A solution tsconfig (`files: []` and `references`, as Vite and
Nuxt 4 scaffold it) lends the aliases of the projects it refers to, and
`resolve.alias` in `vite.config.*` is read for any alias no tsconfig names.
`$app/*`, `$env/*` and Nuxt's `#app`, `#build`, `#components` are the
framework's own modules, so an import of one that does not resolve says the
framework is not installed rather than naming a package called `$app`.

Each reading is said once per repository, as a note: `aliases-from-convention`
(the generated tsconfig is not there), `aliases-from-config` (a solution
tsconfig's projects, a Vite configuration) and
`implicit-imports-from-convention` (how many names, in how many files). A
setting written as code is a row naming it, with the default read in its place
(`framework-setting-dynamic`).
Next.js, Remix and React Router write their aliases in the tsconfig they
scaffold, so nothing is generated there to miss (`fixtures/nuxt-full-stack`,
`fixtures/nuxt4-layout`, `fixtures/svelte-components`, `fixtures/vue-spa`).

**Nuxt layers (P243).** A Nuxt application is also every layer it is built
with, and each local one is read as part of it: a directory of `layers/`
(registered by itself since Nuxt 3.12), and each `extends` entry the
repository holds - a path (`'./base'`, `'../ui-layer'`, `['./theme', { meta }]`)
inside the repository or the workspace the application is in, or a package of
that workspace by its name - with the layers each of those extends in turn.
Every layer is read under the application's version, so a layer's code is in
its own `app/` on Nuxt 4 where it has one, and its server beside it. Its
`pages/` are screens, its `server/api` and `server/routes` are routes,
`server/middleware` stands in front of them, its `composables/`, `utils/`,
`stores/`, `imports.dirs` and `shared/` give the names the application uses
unimported, and its `alias` entries are the application's. A layer outside the
application's directory is part of the service as a package it declares is,
and its files are named from the application: `../ui-layer/pages/catalog.vue`.

Two parts that give one page address, one route or one name follow Nuxt's
order: the application first, then `layers/` from Z to A, then each `extends`
entry followed by what it extends. The higher one's is used and the other is
a note (`framework-layer-overridden` for a page or a route,
`implicit-import-overridden` for a name); two files of one part that give one
name stay `implicit-import-ambiguous`. `#layers/<name>` aliases a directory of
`layers/`. In a layer as in the application, `~` and `@` are the
application's code, as Nuxt resolves them: an import a layer writes with one
for a file only the layer has is a row (`framework-layer-alias`), not a join
to the layer's file. Which layers were read is one note
(`framework-layer-read`). A layer that is not read is a row saying why
(`framework-layer-unread`, `meta.why`): `remote` (`github:`, `gh:`, `gitlab:`,
a URL), `dynamic` (`extends` written as code), `installed` (a package from a
registry under `node_modules`), `not-installed`, `missing`, `outside` the
repository and its workspace (`fixtures/nuxt-layers`).

**Nuxt modules, `dir` and environments (P251).** A Nuxt module runs when the
application builds and adds what no file says, so the modules of the
repository are read for it, as syntax and never run: each file of a part's
`modules/` (`modules/*.ts`, `modules/*/index.ts`, or the directory
`dir.modules` names), each entry of a part's `modules` that is a path from that
part (`'./tools/reports'`, `'~/modules/x'`), and each that is a package of the
workspace by its name, read at its manifest's source entry or at
`src/module.ts` as the module builder lays one out. In a module's file, each
call of Nuxt's kit is read where its argument is a literal or a path built from
the module's own file (`createResolver(import.meta.url).resolve('./runtime')`,
a `resolve` taken from it, `resolve(__dirname, ...)`,
`fileURLToPath(new URL(..., import.meta.url))`, or a name holding one):
`addImportsDir` and `addServerImportsDir` give the names a directory exports to
the application or to the server, `addImports` and `addServerImports` one name
from one file, `addServerHandler({ route, method, handler })` is a way in
declared at the call (`meta.registration: module/addServerHandler`) and one
with no route or `middleware: true` stands in front of every route,
`extendPages` (and the `pages:extend` hook) adds a screen,
`nuxt.options.alias[...] =` an alias over the configuration's (`||=` only
where it names none), and `installModule` reads another module. A module's
names rank with the part that registers it; a call written under a condition
of its options is read or left out as those options say, and read as made and
named in the note where they cannot be read (P255). `addComponentsDir`,
`addComponent`, `addRouteMiddleware` and `addServerScanDir` are read as below. An addition whose
argument is code, or a plain relative string, is a row
(`framework-module-unread`, `meta.why: addition`); so is a `modules` entry
written as code (`dynamic`), written in the configuration itself (`inline`), a
path to nothing (`missing`) or `outside` the repository. Which modules were
read and what each adds is one note (`framework-module-read`). A module
installed from a registry is a package's code and is named in a note
(`framework-module-installed`), with what it adds for the few whose additions
are fixed, documented and their own package's (`@vueuse/nuxt`, `@nuxt/image`,
`@nuxt/icon`, `@nuxt/fonts`, `@nuxt/eslint`, `@nuxt/devtools`,
`@nuxtjs/tailwindcss`, `@nuxtjs/color-mode`); `@pinia/nuxt`'s `stores/` is read
as before. `dir.pages`, `dir.layouts` and `dir.middleware` are read under each
part's `srcDir`, `dir.shared` and `dir.modules` under its root: the pages are
where `dir.pages` puts them (and only a file under that directory is a page),
`#shared` and the shared names are where `dir.shared` puts them. Every
configuration is read as the production build reads it, `$production` and
`$env.production` laid over the rest; development and each name `$env` writes
are read too and compared, and how each differs - a layer, a module, a part's
directories or settings - is one note (`framework-environment-differs`)
(`fixtures/nuxt-modules`).

**Child components, layouts and route middleware (P255).** A tag in a
component's markup that names a component of the repository is a `calls` edge
from the component that writes it to the one it names, at the tag, `static`,
with `meta.renders` the tag as written: rendering `<CartBadge />` runs that
component, so a screen's flow reaches what its children request. A tag is
resolved as its framework resolves it: in Vue, a name the script imports
(`<script setup>`, and the Options API's `components: { ... }`), then one an
application registers for every template (`app.component('Name', X)`, a Nuxt
plugin's `nuxtApp.vueApp.component(...)`), each in the spelling written or
camelised and capitalised (`<cart-badge>` is `CartBadge`), and
`<component :is="X">`; in Svelte, an import (and `<svelte:component this={X}>`);
in JSX, the checker's declaration, through `memo`, `forwardRef` and
`lazy(() => import(...))` - a component a router shows at an address
(`<Route element={<X />}>`, `{ path, element }`) stays a screen of its own. In
Nuxt a tag also names a file of a components directory by its path, as Nuxt
names one: every part's `components/` (`components/global`,
`components/islands`), or what its `components` setting lists with each
directory's `prefix` and `pathPrefix: false`, and each directory or component
a module of the repository adds (`addComponentsDir`, `addComponent`); a
folder is part of the name (`components/base/Card.vue` is `BaseCard`), the
`Lazy` prefix is the same component (`meta.lazy`), and `.client`/`.server`
files of one name are both drawn. Where two parts give a name the higher
part's is used and the other said (`framework-layer-overridden`); two files
of one part giving one name are neither, and a row. A tag written in
PascalCase that names nothing the file imports or registers and nothing the
framework does is a row (`component-unresolved`, folded); the framework's own
(`<NuxtLink>`, `<RouterView>`, `<ClientOnly>`), the components of a known
installed module (`<NuxtImg>`) and a lower-case tag with a hyphen, which HTML
reads as a custom element, are not.

A Nuxt page goes through Nuxt's router on its way to being shown: every route
middleware in front of every page (a `.global` file of a part's
`middleware/`, or one a module adds `global: true`), in the order Nuxt runs
them, then each the page names in `definePageMeta({ middleware: [...] })` in
its order, then its layout - the one `definePageMeta({ layout })` names,
`default` where it names none, none for `layout: false`, and the one
`<NuxtLayout name>` names in `app.vue` for every page. Each is a `calls` edge
from the page with its place in that order (`meta.middleware` or
`meta.layout`, `meta.order`), so a flow from the page walks them as the router
runs them. A middleware is the function its file's default export hands
`defineNuxtRouteMiddleware`; a middleware and a layout are found by the names
Nuxt gives them (`middleware/myAuth.ts` is `my-auth`, `layouts/admin/panel.vue`
is `admin-panel`) in every part, the higher part's over a lower one's, a
module's `addRouteMiddleware` after them unless it says `override`. A name
that matches no file is a row (`route-middleware-unresolved`,
`layout-unresolved`, `meta.why: missing`), as is one written as code
(`dynamic`) and a layout named where `app.vue` renders no `<NuxtLayout>`
(`unrendered`). `<NuxtLayout name="x">` in another component draws it as a
child.

A directory a module adds with `addServerScanDir` is read as `server/` is:
the routes of its `api/` and `routes/`
(`meta.registration: module/addServerScanDir`), its `middleware/` in front of
every route, and its `utils/` as names the server uses with no import.

A module's options decide a condition it is written under where they can be
read: `defu` of the options its `modules` entry hands it
(`['./modules/x', { enabled: false }]`), what the configuration writes under
its `meta.configKey` (every part's, merged), and its `defaults`; a condition of
those options (`options.x`, `!`, `&&`, `||`, `??`, `===` and `!==` against a
literal) in an `if`, `? :`, `&&`, `||` or an earlier `if (...) return` is
evaluated, and a call it rules out is not read, is named in the note and is a
note of its own at the call (`framework-module-skipped`). A
workspace module whose manifest names only a build (`dist/`) is read from the
source of that build: a `source` condition or field, the build's source map,
or the file of `src/` in its place (`dist/kit.mjs` is `src/kit.ts`)
(`fixtures/nuxt-components`, `fixtures/vue-components`).

**Layouts, plugins, async components and Nitro's tasks (P258).** A SvelteKit
page (`+page.svelte`, and `+page@x.svelte`, which is the page of its folder)
goes through every layout up its route tree, the root's outermost: a
directory with a `+layout.svelte`, `+layout.ts` or `+layout.server.ts` is a
layout of every page below it. Every `load` runs before anything is shown -
each `+layout.server` load root first, the page's `+page.server` load after
them, then each `+layout` load and the page's `+page` load - and then each
layout's component wraps the page. Each is a `calls` edge from the page with
`meta.order` (`meta.load: server | universal` and `meta.layout` or
`meta.page`, the route id; `meta.layout` alone for a component), so a flow
from the page reaches what its layouts load and request; a server load is
the handler of the route it answers, so the page's flow reaches the server
half too. A `@` resets the chain: `+page@(app).svelte` is wrapped by the
layout of the `(app)` directory and those above it, `+page@.svelte` by the
root's alone, and a `+layout@x.svelte` resets what wraps it the same way. A
reset that names no directory above the file is a row (`layout-unresolved`,
`missing`).

A component library a plugin installs registers its components by name, in
its package: `app.use(Vuetify)` gives every template `<VBtn>`. A small table
says which names common libraries register - Vuetify (`V` and a capital),
PrimeVue (its own component names, which share no prefix), Element Plus
(`El`), Naive UI (`N`), Quasar (`Q`), Ant Design Vue (`A`) - and a library is
installed where the repository declares its package or a Nuxt module that
installs it, whichever way it registers it. A tag of an installed library,
and a name `app.component('Button', Button)` registers from a package, is the
library's: no edge and no row. A plugin `app.use(X)`,
`nuxtApp.vueApp.use(X)` or `Vue.use(X)` installs from a package the table
does not know may register anything, so a PascalCase tag that names nothing
stays `component-unresolved`, and the row says which plugin may register it
(`meta.plugins`). A plugin of the repository's own is read where it
registers what it registers (`install(app) { app.component(...) }`).
`defineAsyncComponent(() => import('./X.vue'))` and
`defineAsyncComponent({ loader: () => import('./X.vue') })` are the
component they load, held in a name of the script, in `components: { ... }`
or registered for every template.

A Nuxt plugin - a file of a part's `plugins/` (or `dir.plugins`), or one a
module adds with `addPlugin` - may add a route middleware when the
application starts: `addRouteMiddleware('name', fn)` is a named one, and
`addRouteMiddleware(fn)` or `{ global: true }` one in front of every page,
after every global one the build adds, in the order Nuxt runs the plugins
(those modules add, then each part's, the lowest part first, each in the order
of its files). A page that names one is walked through it, and a plugin's
named middleware takes the place of a file's of the same name, as it does
when the application runs. The middleware is the function written in place,
or the one a name of the plugin holds (`defineNuxtRouteMiddleware(...)`
unwrapped); a name or a function written as code is a row at the call
(`route-middleware-unresolved`, `dynamic`).

Nitro's plugins run with every request: a file of a server's `plugins/` - a
part's, and one of a directory a module adds with `addServerScanDir` - and a
plugin a module adds with `addServerPlugin`, in the order Nitro runs them
(the modules' first). Each `nitroApp.hooks.hook('request', fn)` is a step in
front of every route, ahead of `server/middleware` (a `middleware` node
labelled with the plugin and the hook, `source: server/plugins`), and each
`beforeResponse` and `afterResponse` hook one behind it (an `interceptor`). A
file of a server's `tasks/` is a task: a way in of its own of the kind
`task`, keyed by the name Nitro gives it - its path below `tasks/`, `/` read
as `:` (`tasks/db/migrate.ts` is `db:migrate`) - whose handler is the `run`
`defineTask({ ... })` defines; one that defines none is
`fs-route-handler-not-read`. `runTask('db:migrate', { payload })` is a
producer that starts the task by its name (`meta.starts: task`, joined as a
deployed name is joined, its `payload` compared with what `run` is handed),
and each expression of `scheduledTasks` (Nuxt's `nitro.scheduledTasks`,
Nitro's `scheduledTasks`) is a `cron` way in that reaches each task it lists
(`meta.reaches`); a name no task gives is `reference-not-found`. A task is
triggered from outside the graph as a cron job is, so `dead` does not call one
nothing reaches dead.

In a module's condition `nuxt.options.dev` and `nuxt.options._prepare` - read
on the name `setup`'s second parameter holds - are `false`: the production
build is the one read (P251). A call only development makes is not read, and
its `framework-module-skipped` note says so (`meta.why: development`)
(`fixtures/sveltekit-layouts`, `fixtures/vue-plugins`,
`fixtures/nuxt-plugins-tasks`).

**Route middleware outside a plugin, the libraries' own prefixes, and Nitro's
tasks flag (P262).** Nuxt runs its plugins, makes its first navigation, and
then sets up the root component, so an `addRouteMiddleware` at the top of
`app.vue`'s setup (`<script setup>` or `setup()`), or at the top of a function
of the repository that setup calls there (a composable, and the ones it calls
in turn), adds a middleware once, for every navigation after the first: read
as a plugin's is, after every plugin's, its edge saying where it was added
(`meta.setup`, the root component; `meta.addedIn`, the file of the call;
`meta.firstNavigation: false`). Anywhere else - a page's or a child's setup,
a handler, a callback, a composable nothing at startup calls - it is added
only when that code runs, so which navigations it stands in front of is not
in the files: a row at the call (`route-middleware-unresolved`,
`meta.why: scoped`, info), and a page that names a middleware only such a call
adds says the same rather than `missing`. A module's own `addRouteMiddleware`
is its kit's, read with the module (P255).

The table of libraries holds Nuxt UI (`U`, `@nuxt/ui` and `@nuxt/ui-pro`)
beside the six of P258, and reads a prefix the application sets: PrimeVue's
`primevue.components.prefix` (its Nuxt module) or the `prefix` /
`components.prefix` its resolver is handed in the bundler's configuration
(`PrimeVueResolver({ prefix: 'P' })`), and Nuxt UI's `ui.prefix` or the
`prefix` of the plugin imported from `@nuxt/ui/vite`. Under a prefix, the
library's names are the prefixed ones (`<PrimeButton>`), and its own name
alone (`<Button>`) names nothing. A prefix written as code names nothing
either, and a tag that names nothing says which setting may register it. A
library is installed where the manifest declares it or where any part's
`modules` names its Nuxt module (a layer's included), and a library's module
is a known module of the `framework-module-installed` note.

Before Nitro 3, a task is built only where `experimental.tasks` is on -
`nitro.experimental.tasks` of any part's Nuxt configuration, the
application's first, or Nitro's own `experimental.tasks`. Where it is not,
every `task` and `scheduledTasks` way in is still drawn, its code there to
read, and carries `meta.enabled: false`, and one note says the build registers
none of them (`framework-feature-off`): `runTask` finds no task by its name,
and the schedules run nothing. Written as code, the flag is a
`framework-setting-dynamic` row and the tasks are read as built. Nitro 3 (the
`nitro` package, which the server reader now detects) needs no flag
(`fixtures/nuxt-startup-names`).

A SvelteKit configuration takes no port of its own (`sveltekit()`, Remix's
`vitePlugin()`): the dev server's port is `vite.config.*`'s `server.port`,
which P254 reads in every form the file is written (`defineConfig({...})`,
a function returning one). Astro's `--host` and `server.host` choose an
interface, not a port, and join nothing.

**SvelteKit `kit.files.routes` (P251).** Routes (`+server`, `+page.server`,
`+layout.server`) and pages (`+page.svelte`) are read under the directory
`kit.files.routes` names, `src/routes` without one; written as code, it is a
`framework-setting-dynamic` row and the default (`fixtures/sveltekit-routes-dir`).

**GraphQL (P232).** A field a resolver answers is a way in of kind `graphql`,
keyed by its type and name: `entry:orders:graphql:Query.orders`, and
`entry:orders:graphql:Order.customer` for a field of another type, which a
request reaches only through a selection under it (`meta.field: true`). The
server is read three ways: NestJS's and type-graphql's decorated resolvers,
code-first (`@Resolver(() => Order)` with `@Query`, `@Mutation`,
`@Subscription`, `@ResolveField`, a `name:` option, `@Args` by name or with
its options - `name`, `type: () => ID`, `nullable`) or schema-first
(`@Query('orders')` beside the SDL); a resolver map handed to Apollo Server,
graphql-yoga, mercurius or `makeExecutableSchema`, followed through constants,
imports, spreads and arrays; and the schema, from `.graphql` files, `gql` type
definitions and the classes a code-first server decorates. Guards on a
resolver stand in front of its fields as on a controller. The endpoint the
server answers at (`path` of `GraphQLModule`, `/` for a standalone Apollo
Server, `/graphql` otherwise) is an ordinary `POST` route carrying the schema.

A client's operation is a request to that endpoint, joined to a service by its
address as every request is, and then each field it selects is joined to that
service's entry: `hits` from a browser, `http_calls` from another server, with
the request's confidence and `meta.graphql: { operation, field, alias? }`, at
the line of the selection - in the file a fragment is written in, when it is
another. Nested selections reach field resolvers, through
the schema's types; fragments are put in place, from the document or
interpolated into it. Documents are read from `gql` / `graphql` templates,
`graphql(...)` (the codegen client preset, gql.tada), imported `.graphql`
files (with the fragments they `#import`) and codegen's `…Document` constants; calls from Apollo Client (`useQuery`,
`useMutation`, `useSubscription`, `client.query` / `mutate`), urql,
graphql-request (`request`, `GraphQLClient#request`), apollo-angular
(`this.apollo.query`, `watchQuery`, `mutate`, a `Query` service's `fetch` /
`watch`) and `fetch` with a body holding `query`. A field is only ever looked
for in the service the request reached, and nothing is joined by an
operation's name.

`contracts` compares every selection with the schema it is sent to:
`graphql-field-unknown` (a field the type does not have, an error at its
line), `graphql-arg-unknown` and `graphql-arg-required`. `dead` lists a root
field no request selects; a field resolver is reached as soon as anything
returning its type is. Rows: `graphql-document-dynamic` (a document built at
run time, never guessed), `graphql-document-not-parsed`,
`graphql-fragment-not-read`, `graphql-field-no-resolver` and
`graphql-field-resolved-twice`. A service whose source is not here is declared
by its schema: `{ "document": { "kind": "graphql", "path": "catalog.graphql" } }`
gives the same root entries, `declared` (`fixtures/graphql-gateway`,
`fixtures/graphql-declared`).

**GraphQL federation (P241).** A request to a federation gateway is planned
the way the router plans it, statically, so `flow` from a screen reaches the
resolvers of every subgraph and `impact` on a subgraph's field reaches the
screens.

- *Subgraphs* are read from `@apollo/subgraph` (`buildSubgraphSchema`, its
  options or its list of modules), NestJS's `ApolloFederationDriver`, and the
  federation directives of their SDL or of code-first `@Directive(...)`:
  `@key(fields:, resolvable:)`, `@external`, `@requires`, `@provides`,
  `@shareable`, `@override(from:, label:)`, `@inaccessible`, under the names
  `@link(import: [...])` gives them, and federation 1's `extend type`. A
  reference resolver (`__resolveReference` in a map, `@ResolveReference()`) is
  an entry, `entry:customers:graphql:Customer.__resolveReference`
  (`meta.reference: true`).
- *Gateways* are Apollo Gateway in code (`new ApolloGateway(...)` handed to
  Apollo Server, NestJS's `ApolloGatewayDriver`) with
  `IntrospectAndCompose({ subgraphs })` or `serviceList` - the subgraphs named
  in code and composed here from what each one's source declares - or a
  supergraph read from a file, the composition as written (`@join__type`,
  `@join__field`, `@join__graph`). A router is declared by its files:
  `{ "document": { "kind": "graphql", "path": "router/supergraph.graphql" } }`,
  or rover's `supergraph.yaml`, with `router.yaml` beside it read for the path
  it serves and `override_subgraph_url`.
- *Subgraph addresses* are joined to services as requests are: a URL rooted at
  a setting (`process.env.ORDERS_URL`, `${env.ORDERS_URL}`) by the services'
  `baseUrlEnv` and the values the repositories give it, a URL written out by
  its host - a service's name, an alias, `services[].hosts`, a host the files
  name. Never by the subgraph's name. The gateway's endpoint gets an
  `http_calls` edge to each subgraph's endpoint, at the line naming it.
- *The plan*: each selected field goes to the subgraph that resolves it; one
  the parent's subgraph resolves, provides (`@provides`) or holds as a key
  stays there; any other is an entity hop, drawn to the owner's reference
  resolver and then its field resolver; `@requires` plans the fields it needs
  first. Edges go from the request to the subgraph entries, of the request's
  type, with `meta.graphql: { operation, field, gateway, subgraph, hop?,
  choice?, requiredBy? }`, and are no surer than the request's join, the
  route and the composition: `static` for a supergraph read from source or a
  composition of subgraphs every one of which was read, `declared` through a
  router read from its files, `heuristic` when a subgraph the gateway names
  was not joined. A shareable field the parent's subgraph cannot resolve, or a
  progressive override, is a choice the router makes at run time: every owner
  is drawn, `heuristic`, with an info row (`graphql-shareable-choice`).
- *Contracts* compare a selection through the gateway with the composed
  schema: `graphql-field-unknown` says no subgraph has it, and
  `graphql-field-inaccessible` that the composition hides it. Rows:
  `graphql-subgraph-not-joined` (an address reaching no service),
  `graphql-composition-conflict` (two owners not both `@shareable`, or a field
  of an entity its subgraph declares no key for), `graphql-supergraph-drift`
  (the supergraph and a subgraph's source disagree), and
  `graphql-federation-not-read` for what cannot be read, naming which: a
  supergraph the registry hands over at run time (managed federation,
  `APOLLO_KEY`), one built by code at start or not committed, a subgraph
  schema in the registry (`graphref`), a subgraph no gateway in the project
  names (`fixtures/graphql-federation`, `fixtures/graphql-federation-composed`).

**Federation, further (P245).** What federation 2 adds beside fields and keys
is planned the same way (`fixtures/graphql-federation-interfaces`).

- *Entity interfaces.* An `interface Media @key(fields: "id")` one subgraph
  owns, and a `type Media @interfaceObject @key(fields: "id")` another adds
  fields to: composed from the subgraphs, or read from a supergraph
  (`@join__type(isInterfaceObject: true)`, `@join__implements`, a bare
  `@join__field`), every implementation has the interface object's fields,
  which that subgraph resolves as the interface's (`meta.graphql.as` on the
  plan edge). A field it adds is an entity hop to its `Media.__resolveReference`
  and `Media.<field>`; where it fetched the parent, a fragment on one of the
  interface's types (`... on Book`) or `__typename` is an entity hop to the
  interface's owner, whose `Media.__resolveReference` says which type the item
  is. Code-first `@InterfaceType()` with `@Directive('@key(...)')` and
  `@ObjectType({ implements: () => [Media] })` are read too.
- *Contexts.* A type that sets `@context(name: "viewer")` and an argument
  filled by `@fromContext(field: "$viewer { currency }")` - or, in a
  supergraph, `@join__field(contextArguments:)`: the fields the argument needs
  are planned from the nearest type above the field that sets the context, by
  the subgraph that fetched it (`meta.graphql.requiredBy`, `fromContext`). The
  argument is the router's to fill, so it is not in the composed schema a
  selection is compared with. Where nothing above the field sets the context,
  the step says so: `graphql-context-not-reached` (a gap, info).
- *The router's checks.* `@authenticated`, `@requiresScopes(scopes:)` and
  `@policy(policies:)` on a field, its type or the type it returns, from a
  subgraph's SDL (under the name `@link(import:)` gives them), code-first
  `@Directive(...)`, or a supergraph's links (`as:` included): through a
  router, each is a `guard` node of the router - `@requiresScopes(read:orders &
  staff | admin)` - with a `guarded_by` edge from every subgraph entry that
  resolves the field, and the check on the entry's `meta.access`, so `flow`
  and `explain` show it. The edge says `through: <router>`, and `flow` shows
  the check only on a step a request took through that router. Apollo Gateway
  in code does not check them: `graphql-auth-not-checked` (a finding, auth)
  names the fields it composes unchecked.
- *Composed directives.* `@composeDirective(name: "@audited")` with the
  `@link` that imports it is kept in the composition (`directives`, and on the
  fields and types that carry it); one the subgraph never defines nor
  imports, or one two subgraphs take from different specifications, is a
  `graphql-composition-conflict`.
- *A subgraph's own port.* Where a gateway names a subgraph at
  `http://localhost:4001/graphql`, the service whose GraphQL server listens on
  4001 is the subgraph, `static`, with no `services[].hosts`: read from
  `startStandaloneServer(server, { listen: { port } })` (4000 where it names
  none), `app.listen(4002)`, `app.listen({ port })`, and a setting's fallback
  (`process.env.PORT ?? 4003`, `Number(process.env.PORT) || 4003`,
  `config.get('PORT', 4003)`); the endpoint carries it as
  `meta.graphql.listen`. A host `services[].hosts` names wins; two services on
  one port - by their code, or one by the port its setting files give it - is
  `graphql-subgraph-not-joined`, naming both.

**Federation, what the resolvers leave (P252)** (`fixtures/graphql-federation-gaps`).

- *A check on a field with no resolver of its own.* `Book.price
  @authenticated`, read off the book `Query.book` returns: the router's check
  hangs on the entries that answer the field - the resolvers of the fields
  that return its type (or an interface or union it belongs to), followed up
  through fields with no resolver either, and the reference resolvers of an
  entity call for it - for that field only: the `guarded_by` edge and the
  check on `meta.access` say `for: ["Book.price"]`, and `via` names the entry
  (`@authenticated on Book.price, which Query.book answers, checked by
  router`). The plan edge to the entry carries `answers` - the guarded fields
  it answers for this request - and `flow` shows the check on that step only
  where the request asks for one of them, as `!  @authenticated for
  Book.price`; walked from the entry, every one, with `for`.
- *`@inaccessible`.* A field the router does not serve (on it or its type)
  has no check drawn for it, nor is it named by `graphql-auth-not-checked`;
  an answering field that is `@inaccessible` answers nothing.
- *An entity interface nobody can type.* An entity call for `Product` arrives
  as `{ __typename: "Product", id }`; where the subgraph that owns it writes no
  `Product.__resolveReference`, no `__resolveType` and no `__isTypeOf` on one
  of its types (`resolveType` in `@InterfaceType`'s or `createUnionType`'s
  options counts, and the subgraph's endpoint carries what it writes as
  `meta.graphql.subgraph.typeResolvers`), it refuses the call:
  `graphql-entity-type-unsaid` (a finding, wiring) at that subgraph, once per
  interface another subgraph can call it for, and the plan edges of such a
  call say `hop.untyped`.
- *`@requires`, `@provides`, `@external`* are read and planned since P241:
  required fields first, by their owners (`requiredBy`); a provided field
  where its parent is.

**The router's check on a field it fetches for `@requires` (P256)**
(`fixtures/graphql-requires-auth`). The router applies its authorization
directives to the client's operation: a field the request may not read is
taken out before the operation is planned. A field the planner adds to
satisfy a `@requires` is not in that operation, and is fetched without being
checked; composition (Federation 2.9 and later) refuses a supergraph where a
field using `@requires` does not carry the requirements of the fields it
requires, for that reason. So:

- a step that fetches a field only for a `@requires` (its plan edge says
  `graphql.requiredBy`) has none of the router's checks in front of it in
  `flow`, and carries no `answers`; an entry the client selects too is drawn by
  the client's selection, with its check;
- a field using `@requires` whose own requirements do not include every
  requirement of the fields its field set names (nested selections and inline
  fragments included) is `graphql-requires-auth-not-carried` (a finding, auth)
  at the gateway, naming each requirement it does not carry, once per field and
  subgraph. A requirement is carried where what the requiring field asks
  implies it (P261), as the router reads the lists - the outer one any of, the
  inner one all of: every set of names one alternative of each of the
  requiring field's requirements makes up includes one of the required
  field's alternatives. `[["read:weight", "read:estimate"]]` carries
  `[["read:weight"], ["staff"]]`; `[["read:fragile"]]` does not. Scopes asked
  of every request imply `@authenticated`; a policy does not, since whatever
  evaluates it may let an anonymous request through
  (`fixtures/graphql-requires-scopes`).

**A file-system router is four values.** Where the address is the path of a file
rather than an argument of a call, what differs between one router and another
is the root directory, which file names declare a route, the prefix in front,
and which segment spellings are honoured. Next.js (the app router, the pages
router and its API routes), Medusa, SvelteKit, Nuxt and Remix are rows of that
description, read by one walk, so they cannot drift on what counts as a verb read
or a file served at no address (`fixtures/react-next`, `fixtures/medusa-fs-router`).
SvelteKit's `src/routes/**/+server.ts` exports its verbs by name; a group in
brackets drops out, `[id]` and `[[id]]` are params (a matcher after `=` is no part
of the name), so is a segment holding one (`foo-[id]`, keyed `/foo-:param` with
`rawPath` `/foo-:id`, a route apart from `bar-[id]` and more specific than a bare
`[id]`, joined only to a request segment with that text around a value:
`/foo-42`, not `/bar`), `[x+2e]` and `[u+00e9]` are the characters they escape
(`?`, `:` and `/` kept encoded as `%3F`, `%3A`, `%2F`; an escape past the last
code point is literal text), and `[...rest]` is the rest of the path. A request
that leaves an optional segment out (`/files/a.txt` for `[[lang]]/files/…`) is
joined to the route as well. Beside a page, `+page.server.ts` answers the page's
GET by its `load`; where a `+server.ts` beside it exports GET too, that verb keeps
the address and the page's load is its own entry (key suffix `#page`,
`meta.contributes: "page"`) that no request is joined to. A `+layout.server.ts`
load runs with every page beneath it and is no address's GET: it is an entry of
its own (key suffix `#layout:<file>`, `meta.contributes: "layout"`). Two route
files claiming one verb and address otherwise keep the first and say the second
in a `route-claimed-twice` row. Each member of a page's `actions` is a POST to it - the `default` one at the
page's address, a named one at `?/name` after it (an entry keyed
`POST:/orders/:param?/note`, its `meta.action` the name); an action written as a
method has nothing to point at and is a `route-handler-unread` row
(`fixtures/sveltekit-server-routes`). What a `load` or an action returns is its
answer (the page's data, typed as written), and a layout at the root keeps
`rawPath` `/` like every other route. Remix's flat routes are one name per route,
its segments separated by dots - `app/routes/api.orders.$id.ts`, or a folder of
that name holding `route.ts` - where a leading underscore is a layout that adds no
segment (a trailing one only leaves the parent's layout, and what is left is
read as usual: `users.$userId_.edit` is `/users/:userId/edit`), `$id` a param,
`$` the rest of the path, `(en)` an optional literal segment and a dot in
brackets a literal one, whole (`[sitemap.xml]`) or in part (`sitemap[.]xml`); a `loader` answers GET and an `action` POST - or, where the action compares
`request.method` to string literals (`=== 'DELETE'`, `case 'PUT':`), the verbs it
names - and a route module with neither is a page and says nothing
(`fixtures/remix-flat-routes`). React Router v7 declares its routes in
`app/routes.ts` instead: the default export's `route(path, file, children)`,
`index(file)`, `layout(file, children)` and `...prefix(path, children)` are read
into each module's address, its params named as configured (`rawPath`), and each
module is read the way a Remix route module is (`fixtures/react-router-config`).
`flatRoutes()` from `@react-router/fs-routes` - the whole export, spread into a
list or handed to `prefix` / `layout` - reads the directory it names (`routes`
unless `rootDirectory` says otherwise) by Remix's flat convention, under the
address it sits at; a module the config names that is not in the project is a
`route-module-not-found` row at the line naming it. A file-system
router nobody has described — `@fastify/autoload`, or a convention of the
repository's own — is not guessed at: the reader says, at `info`, that it cannot
tell such a repository from a library that merely depends on the framework
(`fixtures/express-fs-router`).

### `flowatlas mcp`

With no flags, serves the graph over stdin and stdout. That is what an editor
runs; you rarely type it yourself.

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | found upward | which project to serve |
| `--db <path>` | the configured one | serve this database directly |
| `--install` | off | write `.mcp.json` into every repository of the project |
| `--repo <name>` | every service | with `--install`, only this one |
| `--dry-run` | off | with `--install`, say what would change and write nothing |
| `--all-tools` | off | list every tool, not only those the project can answer, whatever the configuration's `mcp` block says |

Without `--all-tools` the server lists the tools the project can answer and
tells the client when that changes: the run-time tools appear after
`flowatlas observe`, `check_rules` once rules are configured, and so on
([which tools appear when](mcp.md#which-tools-appear-when)); `mcp` in the
configuration tunes it. A configuration whose `mcp.include` or `mcp.exclude`
names a tool there is none of stops the command at start, exit code 2, naming
the tool and the nearest one.

`--install` merges rather than overwrites, so servers a repository already has
survive. It writes the bare `flowatlas` command when one is on your path and an
absolute path when none is, so it works with nothing installed.

The server answers `initialize` with the command's own version as
`serverInfo.version` (what `flowatlas --version` prints). The tools, prompts
and resources it serves are in the [MCP guide](mcp.md).

---

## Building

### `flowatlas build [dir]`

Reads every repository in the configuration and joins them. The optional
argument is a directory to find the configuration from.

Writes three files to the output directory, `.flowatlas` by default:
`project-graph.json` is the whole graph and the canonical artefact,
`link-report.json` says what joined and what did not, `graph.db` is the same
graph as SQLite and is what every query reads.

Everything else it keeps is in the same directory, and nothing is written into
the repositories it reads:

```
<output>/
  project-graph.json   the whole graph
  link-report.json     what joined and what did not
  graph.db             the same graph as SQLite
  cache.json           the file hashes the next build compares against
  freshness.json       each service's checkout and every file read, for answers to say when the code moved
  stand-ins.json       the package sources and shape files worked out once for every reader
  services/<name>/
    graph.json         one service's own graph, reused when it has not changed
    cache.json         that service's file hashes, whichever reader read it
```

`<name>` is the service's name, written so it is always one directory: lower-case
letters, digits, `-`, `_` and an inner `.` are kept, and anything else, an
upper-case letter included, is written as `%` and its code, so `@shop/Orders`
is `services/%40shop%2F%4Frders/`. Two services never share a directory, even on
a disk that ignores case. A service renamed or removed from the configuration
has its directory removed by the next build, when nothing but the build's own
files are in it.

`stand-ins.json` is internal and versioned on its own: the index of the
package sources a service may read in place of an install (`packageSources`)
and every listed shape file, worked out once by the build and handed to each
repository it reads in a process of its own, so none of them indexes or parses
them again. Nothing else reads it. A reader handed one of another version, or
one it cannot read, works them out itself; `flowatlas extract` run by hand
always does, and comes to the same graph.

An earlier version wrote each service's graph and file hashes into
`<repo>/.flowatlas/`. Where it finds those, `build` names them once, as safe to
delete, and leaves them where they are; `--json` carries the same sentence in
`notes`. A `.flowatlas` that is the configured output itself, which it is when
the configuration sits at the root of the one repository it reads, is not
named. Upgrading reads every repository once, with `cache-invalid:version`, and
the build after that is incremental again.

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | found upward | which project to build |
| `--out <dir>` | the configured `output` | where everything above goes, `services/` included |
| `--concurrency <n>` | processors minus one | how many repositories to read at once |
| `--service <name>` | every service | read only this one and take the rest from the cache. Repeatable |
| `--no-cache` | off | ignore the recorded file hashes and read everything again |
| `--watch` | off | keep running, rebuilding after every change |
| `--wait <seconds>` | `0` | wait this long for a build that is running before stopping |
| `--background` | off | build in a process of its own and return at once; what it says goes to `<output>/build.log` |
| `--timing` | off | print how long each phase took, as JSON |
| `--skip-frontend` | off | leave out the services a frontend extractor reads |
| `--heap <megabytes>` | a share of the machine | heap limit for each repository read |
| `--json` | off | print the report as JSON instead of a summary, with `notes` added when the summary would have said something beside it |

A hash is recorded per source file, so a second build of unchanged sources reads
nothing and still writes every output. Whether each repository's dependencies are
installed is recorded too, because a repository read without them is a different
answer rather than the same answer read faster: the ordinary sequence of clone,
build, install, build re-reads on the second build and says
`dependencies installed in .` for why. Under `--watch` each repository's parsed
program is held open, which is where most of the saving comes from.

What stood in for a package that is not installed is recorded as well: the
shape files each service's `shapes` globs expanded to, with a hash of each, and,
for every package the reading wanted (one it read the source of, one a shape
file declared, one nothing answered or two directories claimed), what the
package index answered. A build that finds any of that moved reads the service
again and says which: `stand-ins changed: shape file flowatlas-shapes/flags.d.ts
added`, `stand-ins changed: package @acme/flags now at flags-lib`, or `now claimed
by 2 directories (...)`. A package directory nothing in a service imports does
not re-read it. The pattern files a service lists (`patterns`, below) are
recorded the same way, each with a hash: a file added under a listed glob, an
edited one and a removed one read the services that list it again
(`stand-ins changed: pattern file flowatlas-patterns/house.yml changed`). The package index is worked out again on every build, a
`--watch` rebuild included, workspace members and all.

`--watch` watches each repository, and beside them what stands in for a
package, so a change there rebuilds without a save in a repository and reads
again only the services it concerns, with the reasons above:

- the directories directly beside the configuration, each one appearing or
  going away, and the `package.json` or `pnpm-workspace.yaml` at the top of
  each and of the configuration's own directory (when a service reads package
  sources from there, the default);
- the members a workspace kept there declares: the directories its globs name
  and each member's `package.json`;
- every `shapes` and `patterns` entry, from its directory, or from the deepest
  directory of it that exists while it does not;
- the files a reading read from outside every repository (a package's source,
  its manifest), each by name;
- where each repository is: one removed and put back is opened and watched
  again;
- the configuration file itself (below).

Nothing deeper is walked, so a large directory appearing beside the
configuration costs one listing. A file inside a repository is its watch's;
the output directory, `node_modules`, `dist`, `build` and dot directories are
never watched, unless a `shapes` or `patterns` entry names one. The line the watch prints when it starts says what it watches,
for example `watching 2 repositories, the directories beside the configuration
and 1 shapes entry`; it is printed once the platform is listening, so a change
made after it is heard (on macOS a watch starts listening a moment after it
starts, and the watch waits for a write into a directory of its own under the
system's temporary directory to be reported first). The configuration file is watched too: an edit to it
rebuilds from the edited one, with every repository opened again for it, a
service it adds watched and one it drops let go. One that does not load says
why, and the watch goes on until it does.

Each repository is read in a process of its own, and the whole of it is held in
memory while it is read, so a large monorepo with its dependencies installed can
want several times the heap the runtime picks by default. A share of the machine
is asked for, divided by how many repositories are read at once and never less
than the runtime would have given; `--heap`, or a limit already on `NODE_OPTIONS`,
wins over that. A read that does not fit says so, names the repository and the
limit that did not hold, and leaves exit code `2`.

Exit code is `2` when a repository could not be read; the others are still built
and joined. A build that fails leaves the graph the last good build wrote, rather
than writing the project minus whatever failed over the top of it. Where there
is no earlier graph to keep, the partial one is written with the failure recorded
against the service, and `doctor` refuses it.

**What the summary says.** Beside the counts of calls, browser requests,
channels and routes, these lines are there to stop a partial reading passing for
a whole one:

```
ways in: 6 found, 1 with a handler that was read, 5 without — only the second number is coverage of what happens after the request arrives
widget contributed no node: read by @flowatlas/extractor-react, and no frontend adapter recognises it, …
web found at arm's length: nestjs-http (through @sibling-types/platform-types)
imports the checker could not resolve: gateway (12) — check their tsconfig paths; what a missing type was going to say is missing from this graph
```

- **`ways in`** counts entry points found apart from entry points whose handler
  was read, because only the second is coverage of what happens after a request
  arrives. It is the same count `doctor` refuses a service on
  (`fixtures/next-hollow`). A route a platform puts straight onto a queue, a
  topic or a bus has no handler by design: its work is the message it sends,
  and it counts as read when that message was.
- **`contributed no node`** names a service a reader opened and put nothing into
  the graph from, with why. It looks like success otherwise.
- **`found at arm's length`** names a framework a service has only through a
  workspace package it declares. That is right when the package's code runs in
  the service, and wrong when the package merely imports the framework's types,
  and the rule cannot tell the two apart, so it says which package it came
  through and leaves the judgement to you (`fixtures/next-sibling-nest-types`).
- **`imports the checker could not resolve`** names the repositories where types
  went unresolved, and how many. Where one of them has no `node_modules` at all,
  the advice about `tsconfig` paths gives way to one sentence saying the read was
  partial, printed once in `extract` and `build` and at the head of `doctor`:

  ```
  billing’s dependencies are not installed, and 12 types could not be resolved: this is a partial read. …
  ```

  Most of a repository still reads without its dependencies — what its own
  source states, including the table a model class names and the application
  `express()` makes (`fixtures/db-not-installed`,
  `fixtures/express-not-installed`) — so the sentence promises only what an
  install recovers: what a package declares, never what a package generates.
  It is never printed for a repository that has had an install.

**The last line: missed, notes, findings.** Every unresolved row is one of three
kinds, decided by its reason (`ROW_KINDS` in `@flowatlas/core`): a **gap** (the
reader could not follow something), a **note** (how a join or a reading was
made; nothing was missed - a base address taken from a repository's own files, a
package read from its source) or a **finding** (something about the code
itself - a likely N+1, a route with no guard). `graph.db` stores each row's
kind, and a finding's risk (auth, performance, wiring), in the `unresolved`
table's `kind` and `risk` columns when the graph is written, and every reader
reads them back; a database written before those columns is read by deciding
them again, the same way. The build ends on one line that counts them apart,
never added together:

```
missed: 9 over 21 sites · notes: 8 · findings: 4 · 3 sites with nothing to join
```

So a request joined from the value a file gives its setting lowers `missed` by
one and raises `notes`, and a likely N+1 is counted where a reader looks for it.
The same five figures, from the same function (`countsOf`), are what `doctor`,
`stats`, the page and the graph server's `start_here` say about one database:

| Name | Counts | Where |
|---|---|---|
| `missed` | gap rows that say something was not read (not at level `nothing`) | build line, `totals.missed`, doctor `unresolved.rows`, page "Missed", MCP `counts.gaps` |
| `sites` | the places the missed rows stand for, folding included | build line (`over N sites`), `totals.sites`, doctor `unresolved.sites` |
| `notes` | rows saying how a join or a reading was made | `totals.notes`, doctor `unresolved.notes`, page "joined from files" |
| `findings` | rows saying something about the code | `totals.findings`, doctor `unresolved.findings` and its findings line |
| `nothing` | places with no edge to draw (gap rows at level `nothing`) | the last clause of the line, doctor `unresolved.nothing` |
| `totals.unresolved` | deprecated since 0.6.0: equal to `missed`, written for one more version | `link-report.json`, `graph.db` |
| `project.unresolved` | every row, all three kinds, nothing dropped | `project-graph.json` |
| `LinkReport.unresolved` | the rows raised while joining, a subset of the above | `link-report.json` |

A report written by 0.5.x has `totals.unresolved` alone; the page, `stats` and
the watch line read `missed` and fall back to it.

**What a service is.** A service is an application together with the workspace
packages it declares, read from `workspaces` or `pnpm-workspace.yaml` and written
down nowhere. The application's directory stays its identity and the directory
every path is measured from, and a file of a package it reads is named as one:
`../../packages/orders-lib/src/index.ts`. So a Next.js application in `apps/web`
whose handler bodies are in `packages/` is one service and one walk from route
to what the handler reaches (`fixtures/next-monorepo`). Which packages count is the line the package
manager draws: the service's own manifest in all four dependency sections,
because its devDependencies are its own build and tests, and a member's in
`dependencies`, `peerDependencies` and `optionalDependencies` only, because a
member's devDependencies are never installed for whoever depends on it
(`fixtures/nest-dev-sibling`). Each package is compiled with its own `paths`, so
an alias only that package's `tsconfig.json` defines resolves inside it
(`fixtures/workspace-package-paths`). A service that is itself the root of a
workspace — functions in its own `src/`, the client they share in
`packages/workflows` — takes in the members of its own workspace it declares,
wherever they sit: a member inside the service's directory is read even though
the service's own code is read from `src/` only, and a member it does not
declare is not (`fixtures/lambda-workspace-root`). A workspace root that
declares none of its members is read as it always was.

**One build at a time.** A build holds `<output>/build.lock` while it reads and
writes, so a watch, a build in another terminal and a hook never write one
database at once. A second build says which one is running and exits 2, or waits
with `--wait`; `--watch` holds the lock for each rebuild, not for as long as it
runs. A lock left by a build that is not running any more (a crash, a closed
terminal) is taken over, and the build says whose it was. A lock taken on another
machine, on a shared disk, is respected and named, since only that machine can
say whether its build is still running.

**In the background.** `--background` returns at once and builds in a process of
its own, waiting for the lock if a build holds it: what a git hook needs, since a
checkout must not wait for a build. When one is already waiting, a second request
is that one's too, so ten checkouts during one build earn one more build, not
ten. `<output>/build.log` holds what it said, moved aside to `build.1.log` past
1 MB.

**Whether the graph is behind.** Every build writes `freshness.json` beside the
database: the commit and branch each service's checkout was on, whether its files
differed from that commit, and the size, time and hash of every file it read. The
asking commands and the graph server's tools compare an answer's files with it:
an answer citing a file that changed since says so, on stderr for a person
(`built before 1 of the 4 files this answer cites changed
(orders/src/orders/orders.service.ts): run flowatlas build`) and as `stale` in
the JSON. A file whose time moved and whose text did not, a `touch`, is not a
change. `doctor` says which checkouts moved to another commit or branch since the
build (`checkout-moved`, an info row that decides no exit code), and the graph
server's `start_here` says the same under `moved`.

### `flowatlas agents install | status | remove`

Tells each assistant in the project's repositories when to ask the graph rather
than search the files, and with `--hook` adds a Claude Code hook that says, after
a search, what lies in the repositories it could not see (P227). The files, the
hook and what each says are in the
[graph server guide](mcp.md#tell-the-assistant-when-to-ask).

| Flag | Does |
|---|---|
| `--instructions` | also a marked block in `AGENTS.md` (made where there is none), `CLAUDE.md` and `.github/copilot-instructions.md` (where they are) |
| `--hook` | also the search hook, in `.claude/settings.local.json` |
| `--shared` | the hook in `.claude/settings.json`, committed, instead |
| `--force` | replace a guide edited by hand, or a file of that name that is not flowatlas's |
| `--repo <name>` | only this service's repository |
| `--dry-run` | say what would change and write nothing |

`status` says, for each file, `installed`, `out of date` (the services changed
since it was written), `missing`, `edited by hand` or `not flowatlas`. `remove`
takes out what `install` wrote and nothing else, and keeps a guide edited by
hand unless `--force`.

### `flowatlas publish` and `flowatlas pull [source]`

One graph for the team (P236): CI builds and `publish`es the project's graph as
one file, and anybody `pull`s it to ask the whole project from a checkout of one
repository. The whole guide is [One graph for the team](team.md).

| Command | Does |
|---|---|
| `flowatlas publish [--output <file>]` | writes the graph just built, each service's own graph, and what is read beside them, with a manifest and checksums, as `<output>/flowatlas-graph.tgz`; never source |
| `flowatlas pull [source]` | fetches `source` or the configuration's `remote.url` (`gh:owner/repo/artifact`, `https://…`, a file), checks it, and installs it in `<output>/pulled/`; `--force` pulls even when nothing changed |
| `flowatlas build --on-pulled` | reads the repositories checked out here, and takes every other one from the pulled graph |
| `flowatlas diff --pulled [head-ref]` | compares this checkout with the pulled graph, which is read rather than built |

With a `remote` in the configuration, a service whose repository is not checked
out is allowed, and every question reads the pulled graph when none was built
here.

### `flowatlas hook install | status | remove`

Git hooks that rebuild the graph in the background, so it follows a checkout or a
merge without anyone running anything.

```sh
flowatlas hook install              # every repository of the project
flowatlas hook install --dry-run    # say what would change
flowatlas hook install --repo web --on checkout,merge
flowatlas hook status
flowatlas hook remove
```

They are `post-checkout` (a branch checkout only, not `git checkout -- file`),
`post-merge` and `post-rewrite` (a rebase), each running
`flowatlas build --background` and returning at once. `--on commit` adds
`post-commit`, which is not the default: a commit changes no file on disk, and an
answer already says when a file it cites moved.

What is written is a marked block (`# flowatlas:hook` … `# /flowatlas:hook`), so
a hook a repository already has keeps every line of its own and `remove` gives it
back as it was. A hook that is not a shell script is left alone and named. A
repository whose hooks another tool keeps (`core.hooksPath`: husky, lefthook, a
team's folder) is not written into at all; the line to add there is printed. A
repository holding several services gets one set of hooks, and worktrees share
their repository's. `init` prints the command; `init --git-hooks` runs it.

### `flowatlas extract <repo>`

Reads one repository on its own, without joining. Useful for looking at what a
single service produces, and for a repository's own CI that wants its graph as a
file. `build` runs it once per service with `--out` set to that service's
directory under the build's output, which is the only reason `build` ever
writes a `graph.json`; run on its own, `extract` writes to `--out`, which is
`.flowatlas` in the repository unless you say otherwise.

| Flag | Default | Does |
|---|---|---|
| `--out <dir>` | `.flowatlas` | where `graph.json` goes |
| `--config <file>` | none | a configuration, to take the service name and adapter settings from |
| `--tsconfig <file>` | found in the repository | which TypeScript configuration to parse with |
| `--bootstrap <file>` | `src/main.ts` | the application entry file, when it is somewhere else |
| `--no-types` | off | skip type collection, leaving the registry empty |
| `--no-cache` | off | do not record file hashes beside the graph |
| `--types-depth <n>` | from the configuration | how deep an anonymous shape is written out |
| `--json` | off | print the summary as JSON |
| `-v, --verbose` | off | log each pass |

**Which files are read.** A service's own code is found under its source roots,
and `build` and `extract` ask one function for them, so the files a reading opens
and the files the build cache stamps cannot differ. The roots are, in order:

1. the directories the tsconfig's `include` and `files` name — a pattern stands
   for the directory before its first wildcard, and a file for the directory it
   is in, because the compiler follows imports from it. A relative `extends` is
   followed when the tsconfig itself names neither;
2. when it names nothing, `src` where there is one, and the whole repository
   where there is not — the whole repository always for `react`, whose screens
   live wherever its framework's convention puts them;
3. beside either, for a server whose deployment is read, every directory the
   deployment packages functions from, mapped back from compiled output by the
   tsconfig that wrote it.

A root outside the repository, under `node_modules`, `dist` or `build`, or hidden,
is left out; a root named like a test is left out and reported as a test
directory is. `fixtures/lambda-functions-beside-src` keeps its handlers in
`functions/` beside `src/`, with a tsconfig that names `src` only: the deployment
names `functions`, so both are read.

---

## Asking

Three of these follow the graph and share one set of flags. Four report on it and
share a different, smaller set. The difference is real: a command that reports on
the whole graph has no walk to bound, so it is not offered `--depth`.

### Shared by the walking commands

`flow`, `impact`, `channel`, `path`:

| Flag | Default | Does |
|---|---|---|
| `--detail <0-3>` | `1` | 0 identity only, 1 adds location, 2 adds metadata, 3 is answered at 2 |
| `--format <name>` | `tree` on a terminal, `json` in a pipe | one of `tree`, `json`, `mermaid`; `flow` also `sequence` |
| `--depth <n>` | `8`, and one more per step: of the workflow `flow` starts at, of every workflow `impact` climbs through | how many hops to follow |
| `--max-nodes <n>` | `150` | most nodes to print, after which it says how many it cut |
| `--service <name>` | every service | narrow to one |
| `--ascii` | off | plain prefixes instead of icons |
| `--no-color` | off, or on when `NO_COLOR` is set | never colour the output |

**On choosing a format.** All three render the same walk, but they do not carry
the same facts. A tree is roughly a twelfth the size of the same trace as JSON,
because JSON repeats every key and every full node id; it is the cheapest thing
to hand to a person or a model. JSON is the one to parse, and the only one
carrying node ids, so it is what you want if a follow-up has to name a node.
Mermaid names every edge and its confidence, but drops locations and ids: it is
for pasting into a pull request, where it renders as a diagram. `sequence`
(`flow` only) is the walk as a Mermaid sequence diagram: what crosses from one
service to another, in call order, the diagram `flowatlas diff` draws for a
changed flow.

### `flowatlas flow <entry>`

Follows one way in through every service it reaches.

The entry can be named the way you would say it, and all of these mean the same
route:

```sh
flowatlas flow "POST /orders/12345"
flowatlas flow "POST /orders/:param"
flowatlas flow "entry:orders:http:POST:/orders/:param"
flowatlas flow "bot:order_confirm"        # a bot command or button
flowatlas flow "invoke:library-dev-create-loan"   # a function, by its deployed name
flowatlas flow "workflow:loan-approval"   # a state machine, by its name
```

A name matching two services comes back as a choice rather than a guess. A name
matching nothing comes back with the nearest few. Where a route that spells a
segment out and one with a hole there both answer, the spelled-out one is meant,
as the router and the linker read it: `flow "GET /orders/latest"` is the route
registered as `/orders/latest`, not `/orders/:param`. The graph server's tools
resolve a name the same way.

Each node is written out once. Met again - a helper every method calls, a
logger - it is a `↺` line (`(again)` with `--ascii`) under the new caller, and
its subtree is under the first; a cycle reads the same way. When the walk is
cut, the last line says how much it left out and which flag shows more:
`… truncated: 12 more nodes (raise --max-nodes)`, or `(raise --depth)` when the
depth stopped it. Which rows get room is decided by what they lead to: the steps
that leave the service first, plumbing last; the tree is still in call order.

Two kinds of way in are named by their full id. A procedure has no verb and no
path, only the dotted path its callers write, so it is
`entry:<service>:rpc:orders.list`; `flow "orders.list"` answers with that id as
the suggestion. And a service that creates more than one application puts the
application in the id, because an address is an address within one application:

```
entry:api@ApiModule:http:GET:/health
entry:api@WorkerModule:http:GET:/health
entry:shop@examples/blog:http:GET:/api/orders
```

`flow "GET /health"` there comes back as that choice, naming both.

**As a sequence.** `--format sequence` draws the walk as a Mermaid
`sequenceDiagram`: the caller of the way in, a participant per service, each
channel and outside API one of its own, each table inside its service's box.
The messages are the steps that cross from one participant to another - the
request into the way in, a request to another service, a publish onto a channel
and the handler that takes it, a query - numbered, in call order, a loop as
`loop` and a `Promise.all` as `par`; a step the graph guessed says
`(best guess)`, and a place the walk cannot see past is a note where it stopped
(`stops here: target-route-not-found`). `--sequence-detail class` draws a
participant per class inside each service, with the calls between them. Without
`--depth` a sequence is walked 16 hops (more for a workflow), as far as `diff`
walks one, so the diagram is the one a pull request shows for that way in,
without the marks:

```sh
flowatlas flow "POST /orders" --format sequence
```

The last line, `unresolved on this path: N` (`unresolvedOnPath` in JSON and in
the MCP `get_flow`), counts the nodes of the walk that something could not be
read about: a node the graph names and does not hold, or one a `doctor` row is
recorded against. Every node the walk reaches counts, the entry a path ends at
included — a function deployed with a handler that could not be read is where a
path through a queue to it stops, and its row is why — and so do nodes past the
`maxNodes` the tree shows.

A row is recorded against the node a walk passes. Rows about something a
deployment declares name the node drawn for it: a function's `invoke` entry, a
route's entry, the consumer a rule, mapping or subscription delivers to. A route
integrated straight with a function whose handler is not read reaches that
function's entry, so the walk from the route counts the same row a path through
a queue to it does. A publish or a start whose name could not be read is still
drawn, as a producer the body calls, and its row names that producer: a walk
through the body counts it, and what was not read — the body, then the
expression, `queueOverdue -> process.env.OVERDUE_QUEUE_URL` — is the row's
`message` (`fixtures/aws-sdk-publishers`, `fixtures/start-workflow-by-record`).
A handler whose channel could not be read is on no channel and under no entry,
so no walk passes it, and its row names the method as it is written.

### `flowatlas impact <symbol>`

Every entry point that can reach a symbol, and what lies between. The symbol can
be a node id or a name close enough to identify one.

| Extra flag | Does |
|---|---|
| `--entries-only` | list the entry points instead of the whole chain |

### `flowatlas path <from> <to>`

How one node reaches another, by the shortest ways (P229). Both ends are named
the ways `impact` takes a symbol: a node id, a route said aloud, a unique
`Class.method`, `event:order.created`, `workflow:loan-approval`.

```sh
flowatlas path "POST /orders" "table:billing#invoices"
flowatlas path "GET /orders/:id" "POST /orders" --undirected
flowatlas path "POST /orders" "InvoicesService.create" --format sequence
```

Directed by default: along the edges `flow` walks, the way the calls run, so the
answer is how a request gets from one to the other, through other services,
channels and workflows. `--undirected` walks an edge either way, which answers
whether the two are joined at all. Without `--depth` it looks 6 steps, then 12,
then 24, so a near path costs a near search.

Every node on a shortest path is printed once, as a tree from `from` in call
order; a node two paths share is written under the first and is a `↺` line under
the other. Past `--max-nodes` one whole path is printed first, so a cut never
leaves a gap, and the last line says how many nodes were left out. The footer
says how many shortest paths there are, of how many steps, and
`unresolved on this path`, counted as `flow` counts it.

With no path, it says how far it looked and how many nodes it reached, and exits
1. Asking the wrong way round is the common mistake, so it then looks the other
way: `entry:orders:http:POST:/orders reaches table:orders#orders instead, in 4
steps: flowatlas path …`. A name that means several nodes, or none, stops with
the candidates or the nearest names (exit 1). Exit codes are the same table as
every command's; `--format json` says `state: found` or `none` beside them.

| Extra flag | Does |
|---|---|
| `--undirected` | walk an edge either way |
| `--sequence-detail <level>` | with `--format sequence`, one participant per `service` or per `class` |

The search is the page's path finder's (`shortestWays` in core): the page, this
command and `get_flow` with `to` find the same paths.

### `flowatlas explain <name>`

Everything the graph knows about one name (P229): where it is, what reaches it
and what it reaches, its shapes, failures, guards, gaps, the pages that describe
it, what traffic saw, and the calls to make next. The text is the graph server's
`describe_for_prompt`, character for character, and the page's *Copy as prompt*:
one renderer for every surface, so the terminal never says something an
assistant is told differently.

```sh
flowatlas explain "POST /orders"
flowatlas explain OrdersService --scope class
flowatlas explain billing --scope service
flowatlas explain "gap:orders|src/orders/orders.service.ts|unknown-base-url-env"
```

It takes every name `describe_for_prompt` takes: a node id, a route said aloud,
a channel, a gap id, a `file:line`, and with `--scope` a class, a file
(`service#path`) or a service. Markdown is printed as it is, in a pipe too, since
it is read or handed on as it is (`flowatlas explain "POST /orders" | pbcopy`).

| Flag | Default | Does |
|---|---|---|
| `--scope <scope>` | `node` | `node`, `method`, `class`, `file` or `service` |
| `--max-steps <n>` | `40` | most chain steps written |
| `--max-chars <n>` | `8000` | most characters written |
| `--with-spec` | off | add the route's or channel's part of the written API document |
| `--format <name>` | `markdown` | `markdown`, or `json` for the tool's whole answer, `next` included |

A name that means several things stops with the candidates, and one nothing has
says so (exit 1); a scope the node does not have names the ones it has (exit 2).

### `flowatlas channel <name>`

Who publishes to a channel and who handles it. Accepts `order.created` or
`channel:order.created`. A channel nothing handles comes back with an empty list,
which is an answer rather than an error.

### `flowatlas types`

The type registry, listed or compared.

| Flag | Default | Does |
|---|---|---|
| `--detail <0-3>` | `1` | how much of each entry to show |
| `--format <name>` | `tree` on a terminal | `json` or `tree` |
| `--drift` | off | only names two repositories declare differently |
| `--name <glob>` | every name | only names matching, `*` and `?` allowed |
| `--service <name>` | every service | narrow to one |

`--drift` is the one worth running on a schedule: it finds a type two services
each declare for themselves and which have drifted apart. It compares hashes and
stops there; `flowatlas contracts` is the same question answered field by field.

### `flowatlas contracts`

What each service sends against what the other declares, on every boundary in
the project: every call to another service's route, every request from a
browser, and every message on a channel. Both halves of each are checked
separately, because a caller sending a body the handler cannot read and a
handler answering with a shape the caller does not expect are different bugs.

The rules of the JSON wire are applied before anything is compared — a date is
text, a big integer is text, binary is text, a field holding nothing is not
written at all, the serialisation annotations rename and drop fields, a document
store's identifier is text, and neither a set nor a map survives at all. Without
them the check would report most of a real project as broken on its first run.

| Flag | Default | Does |
|---|---|---|
| `--format <name>` | `text` | `text`, `json`, `markdown` or `sarif` ([SARIF](#--format-sarif-findings-for-code-scanning); `--severity` is then the least level written) |
| `--severity <level>` | `info` | least severe finding to show: `error`, `warning` or `info` |
| `--fail-on <level>` | `none` | exit 1 on a finding at this level or worse: `none`, `error`, `warning` |
| `--edge <key>` | every boundary | only this one, as `from\|type\|to` |
| `--service <name>` | every service | only boundaries this service is on either side of |
| `--direction <name>` | all three | only `request`, `response` or `payload` |
| `--depth <n>` | `contracts.depth`, else `3` | how far into nested shapes to compare |
| `--max-nodes <n>` | `150` | most findings to print; the file is always complete |
| `--out <dir>` | the configured output | where to write `contracts.json` |
| `--no-ignore` | off | report what `@ContractIgnore` excuses as ordinary findings |
| `--output <file>` | stdout | with `--format sarif`: write the log here and print one line about it |
| `--sarif-root <dir>` | the configuration's directory | with `--format sarif`: paths relative to this checkout ([SARIF](#--format-sarif-findings-for-code-scanning)) |
| `--sarif-level <level>` | `note` | with `--format sarif`: leave out results below `error`, `warning` or `note` |

Every run writes the whole report to `<output>/contracts.json`, whatever it
printed and whatever it exited with. Exit `0` means it ran and found nothing at
or above `--fail-on`; `1` means it did; `2` means it could not run at all.

Four kinds of finding, and the level each carries: `missing_required` and
`type_mismatch` are errors, `optionality_mismatch` is a warning, `extra_field`
is information. A named rule may soften a verdict and never sharpen one.

A boundary that could not be compared is not left out: it is listed under
`unchecked` with the reason and the thing to do about it, so "no errors" can be
read as "nothing broken" rather than "nothing looked at". The reasons:
`no-type-on-sender` and `no-type-on-receiver` (one end declares no type),
`body-already-serialised` (text where a shape should be), `type-missing` (a
type named that is not in the registry), `type-kind-unsupported` (a type from a
package that was not read), `ambiguous-handler` (two handlers declare the
route), `channel-without-producer` and `channel-without-consumer`,
`procedure-input-undeclared`, `procedure-input-unread`,
`procedure-input-not-at-call`, `procedure-input-by-name` and
`procedure-output-inferred` (see *What is not compared, and says so* under
[Top level](#top-level)), and the delivered-message reasons in the table
further down.

**Traffic as a third side (P113).** Beside an observed file `observe --shapes`
wrote, the report gains a `traffic` section: for each route traffic carried
bodies of, its request and each 2xx answer compared with what the code
declares, traffic being what was sent both ways. A field sent that the type
lacks is `extra_field`, a declared field no body carried `missing_required`,
one carried only sometimes where it is declared always present
`optionality_mismatch`, and a declared optional field none of at least 50
bodies carried `declared_never_sent` (information; `flowatlas dead` lists it
among its fields with `neverSentIn`). Each row says `seenIn` of `of` bodies, so
a field sent in 3 of 400 requests reads as rare. Traffic is one environment
over one window: it is never an `error`, never counted in the summary, and
never fails `--fail-on`. `--service`, `--direction` and `--edge` narrow it as
they narrow the rest.

**A message delivered by AWS is compared through the envelope it arrives in.**
A function a queue, a topic or a bus delivers to is not handed the message: it
is handed an event with the message inside it. A queue's message is the text at
`Records[].body`, a topic's the text at `Records[].Sns.Message`, a bus's the
value at `detail`; a function invoked, or a workflow started, is handed its
input as it is. The publisher's payload (`MessageBody`, `Message`, `Detail`,
seen through `JSON.stringify`) is compared with what the handler takes from
that place - the type it declares there, or what it parses the text there into
(`JSON.parse(record.body) as Loan`). A start's `input` or `Payload` is compared
with the invoked handler's parameter, or with what the started workflow's
first state reads of its input (`"id.$": "$.loanId"` requires `loanId`); keys a
workflow does not read there are carried on, so they are never reported as
extra. A rule or a subscription that hands a message on to another queue or
topic hands on the envelope, so whatever reads that queue is compared with the
envelope around the original message - a handler of a rule's queue that
parses the body as the message, when the message is at `detail`, is a
`missing_required` error. A rule that puts the events it takes on another bus
hands on the event as it is, so a function that bus's rules deliver to is
compared with the original message at `detail`. Each finding says where the
message was read from.

What cannot be compared this way stays `unchecked`, with one of these reasons:

| Reason | Means |
|---|---|
| `envelope-unread` | the delivery rewrites what its target is handed (`input_transformer`, `input_path`, `input`), or is a pipe |
| `message-unparsed` | the handler never parses the text at the message's path into a declared type |
| `message-undeclared` | the handler, or the workflow's first state, declares nothing at the message's path |
| `handler-unread` | the function's handler was not read as the function handed the event: built by a factory, or not found |
| `delivered-onward` | the delivery hands the message on to another channel; it is compared where that is read |
| `delivery-target-unread` | the delivery's target is no code this project reads, such as an e-mail address |
| `sender-forwards` | the sending end hands on what it was given - a route sending its request to a queue, a forward with no typed publisher behind it |

### `flowatlas stats`

What the built graph is made of: counts by node and edge type, per service, and
the reconciliation from the last build. The first line counts the unresolved rows
as `build` does (`missed: 9 · notes: 0 · findings: 4`), and `--format json`
carries them as `totals.missed`, `sites`, `notes` and `findings`, with
`totals.unresolved` equal to `missed` for one more version. The breakdown by
reason lists the missed rows. `receivers explained by a drawn call`
(`receiversExplainedByEdge` in JSON) counts the calls that looked like data by
name and are not listed because a `static` call edge into the service's own
repository method explains them (P88). `loops set aside: chunk 1 · page 2`
(`loopsBounded` in JSON, `none` when there are none) counts the loops that run a
query per item and are bounded on purpose, by why (P89).

| Flag | Default | Does |
|---|---|---|
| `--format <name>` | `tree` on a terminal | `json` or `tree` |
| `--detail <0-3>` | `1` | how much of each row to show |
| `--service <name>` | every service | narrow to one |
| `--questions` | off | what the [question log](#the-question-log) says was asked, instead of what the graph holds |
| `--since <when>` | the whole log | with `--questions`: from a date (`2026-11-01`) or a span back from now (`24h`, `7d`, `2w`) |

#### The question log

Off by default. With `"log": { "questions": true }` in the configuration, or
`FLOWATLAS_LOG_QUESTIONS=1`, every MCP tool call and every `flow`, `impact`,
`channel`, `path` and `explain` appends one line to
`<output>/questions.jsonl` (P235): the tool, the ids and names it was given,
whether a name matched nothing or several things, how many rows came back and
whether a limit cut them, the gaps on the answer's nodes by the ids `accept`
takes, whether the answer was stale, and how long it took. What an assistant was
asked never reaches the server and is not in the log; a search's words are kept
only with `"text": true`. The file stays on this machine: nothing in the tool
sends it anywhere. Past `maxBytes` (5 MB) it is moved to `questions.1.jsonl`, so
at most two are kept.

`stats --questions` reads it: each tool with how often it was asked, came back
empty, was cut short (and by which limit), was given a name that matched nothing
or several things, its median and p95 time and its median size; how many answers
were stale; the names asked for that matched nothing; the gaps the most
questions ran into, each with the command that lists its rows, or `fixed since`
when the graph no longer has it; the slowest questions. A line the log cannot
parse, as a crash can leave, is skipped and counted. A log that cannot be
written is said once on stderr and then left alone; answers are unaffected. `doctor --unresolved` reads it
too: with a log beside the graph, each cause says how many questions ran into
it, and the causes asked about come first.

```json
{ "log": { "questions": true, "text": false, "maxBytes": 5242880 } }
```

### Shared by the reporting commands

`cycles`, `dead`, `config`, `hotspots`:

| Flag | Default | Does |
|---|---|---|
| `--format <kind>` | `table` | `json` or `table`; `cycles` and `dead` also `sarif` |
| `--max <n>` | `150` | most rows, after which it says how many it cut; with `--format sarif`, most results (5,000) |

`cycles` and `dead` also take `--output`, `--sarif-root` and `--sarif-level`
with `--format sarif` ([SARIF](#--format-sarif-findings-for-code-scanning)).

These say `table` where the walking commands say `tree`, because the output is
rows rather than a shape. Their `--format json` documents carry one version,
`analyticsFormatVersion: 2`, shared by all four so they move together (version
2: a `fields` row says which way the field was travelling and whether the
receiver removes it).

### `flowatlas cycles`

Circular dependencies, cross-service ones first. A channel is collapsed into the
one hop it really is, so a publisher and its handler read as a single step.

| Flag | Default | Does |
|---|---|---|
| `--cross-service` | off | only cycles that leave a service and come back |
| `--include-di` | off | follow injection too, so `forwardRef` cycles appear |
| `--min-length <n>` | `2` | smallest cycle reported. `1` includes self-recursion |

### `flowatlas dead`

Entries, channels, providers and fields nothing appears to reach. Every row says
why the answer might be wrong, because most of them are reachable in ways static
reading cannot see.

| Flag | Default | Does |
|---|---|---|
| `--kind <kind>` | `all` | one of `entries`, `channels`, `providers`, `fields`, `all` |
| `--class <class>` | every class | only entries of one class: `actionable`, `stream`, `infrastructure`, `declared` |
| `--service <name>` | every service | narrow to one |
| `--since <dur>` | all the file holds | with an observed file: read traffic over the last `2h`, `7d`, `2w` of it (`all` for everything) |

A route nothing calls is put in a **class**, which is not the same question as
whether it is dead, and every row says which rule put it there (`why`):

| Class | Rule (`why`) | What it means |
|---|---|---|
| `declared` | `doctor.publicRoutes <pattern>`, or `@flowatlas-public <why>` on the handler or its controller | its callers are outside the project by decision |
| `infrastructure` | `dead.infrastructure.paths`, `.decorators` or `.names` | the configuration names it (role `configured`) |
| `infrastructure` | `decorator @HealthCheck` | a probe, whatever its path (role `probe`) |
| `infrastructure` | `path …` | a probe: the last segment is `health`, `healthz`, `ping`, `readyz`, `metrics`, `status` and the like; a webhook: a segment `webhook`, `webhooks` or `hooks` at any depth, or `notify` / `notifications` on anything but a `GET`; a callback: a segment `callback` or `callbacks` (`/oauth/callback`, `/auth/callback`); a well-known address: `/.well-known/*` (role `probe`, `webhook`, `callback` or `discovery`) |
| `infrastructure` | `name …` | a handler or controller named for what it answers: ending in `Webhook`, `Callback` or `Probe`, a `HealthController`, a handler starting `handleWebhook` or `onCallback` |
| `stream` | `path …` | the last segment is `stream` or `sse`, or ends in `-stream`; a browser subscribing to one is not read yet |
| `actionable` | `no caller read` | nothing above applies, which is what this command is for |

Only the last segment of a path is read for a probe, so `/api/health` is a
probe and `/api/health/reports/:param` is a route like any other. `status` and
`metrics` are words a business API uses too, so they count only within two
segments of the root: `/api/status` is a probe and `/api/orders/:param/status`
is a route. A segment starting with `_` or ending in `-status` counts at any
depth. `GET /users/:param/notifications` is a list a screen reads, not a
receiver, and stays actionable.

**`likely-dead`.** Every row has a `confidence`: `dead`, or `likely-dead` where
a request that joined nothing could still reach the route — its address was read
in part, and what was read matches the route when each unread piece stands for
the rest of its segment and any segments after it, or its address was read in
full and only its verb was not. Such a request is aimed at the route's service
(its setting names that service, or, for a browser, its `apiTarget` does). The
row names it under `evidence.couldHit` (up to three, `{ call, path, file, line }`) and no
edge is drawn: a hole may be the caller and may not. The build lists them in the
link report as `routes.nearMissed`, by route id.

**Verdicts (P95).** Every row also says what it claims, under `verdict`, with
what could make it wrong under `evidence`: `dead` (nothing reaches it and
nothing that could is unread), `likely-dead` (a request read in part could:
`couldHit`) or `unknown` (the graph's silence says nothing). A route of any
class but `actionable` is `unknown`, with `outside` naming why (`probe`,
`webhook`, `stream`, `declared`, …). An actionable route that a request which
found no route is one segment off is `unknown` too, with the request under
`oneOff` (`{ call, asks, differs, file, line }`): one literal for another
(`cancel for archive`), a value left out (`POST /orders/ship` for `POST
/orders/:param/ship`), or a segment added. Renamed, or a typo: only a person
can tell. A channel missing an end is `dead` with `missing` (`unknown`, with
`outside: stream`, when its publisher serves event streams); a class is
`likely-dead` with `unresolvedInjects` when its service has injects that did
not resolve. The MCP server's `dead` tool reads the same functions.

The table lists the actionable rows, `dead`, then `likely-dead`, then `unknown`, with each near
miss and each request one segment off on a line of its own beneath; every other class is folded into one line:

```
  GET:/items/:param/price could be reached by /items/:param/${…}${…} at src/app/items.client.ts:59
  POST:/orders/:param/archive is one segment off POST /orders/:param/cancel at src/clients/orders.client.ts:44 (cancel for archive)
  4 infrastructure routes: 2 probes, 1 callback, 1 webhook — --class infrastructure to list
```

`--class <class>` lists that class instead, each row with its rule. The channel
and provider tables have a `verdict` column too. `--format
json` carries every row (to `--max`) with `class`, `why`, `role`, `confidence`,
`verdict` and `evidence`. Rows are ordered by what they mean rather than by name — the
ones nothing explains first — so `--max` cuts the rows that say why they are
here before it cuts the rows that do not (`fixtures/multi-repo-dead-routes`).

**Traffic as evidence (P110).** With an observed file beside the database
(`flowatlas observe`), every verdict is read beside what traffic did, and the
entry and channel tables gain a `seen` column: `seen ×n`, `never in 7d
(strong)`, `never in 7d (weak)`, or `—` where traffic says nothing (a service
with no span in the window, or a method of a service whose spans name no
methods). Seen in the window is `alive`, whatever the static answer, under
`evidence.seen` (`{ count, lastSeen, window }`); a route the build found nobody
calls that traffic reached says so — static reach missed a caller, a blind
spot. Never seen is `evidence.neverSeen` (`{ window, confidence }`): `strong`
when the file holds the whole window asked for and a sibling (a way in of the
same service and kind, a method of the same class, a channel of the same
service) was seen at least 20 times, `weak` otherwise. A way in nothing in the
code reaches, `unknown` by static reading, that was never seen beside a busy
neighbour is `likely-dead`; a static `dead` stays `dead`, with the silence as
corroboration. `--since` cuts the window at read time from the file's hours,
ending where the file does, so `7d` and `30d` differ without the traces at
hand; over a window longer than the file holds, every row is `weak` and the
header says so. Without the file every table is exactly as before. Traffic is
what was exercised, by whom, in which environment: it is evidence, never a
reason to delete code.

```
traffic over 2h: seen is alive whatever the code says; never seen is strong only beside a busy neighbour
  entry:gateway:http:POST:/orders/pay      src/orders/orders.controller.ts:45      dead   never in 2h (strong)  no http_calls/hits from any repo (may be a public API)
  entry:billing:http:GET:/invoices/:param  src/invoices/invoices.controller.ts:26  alive  seen ×3               …; seen 3 times in 2h at run time, so something static reach does not see calls it (a blind spot)
```

`--kind fields` reports a field one side sends and the other does not declare.
The rows are the ones something happens to: a field the receiver's whitelisting
`ValidationPipe` removes on arrival, so the sender believes it sent something
that never landed. That is read from the receiver's own validation, not guessed
from the direction. Everything else — a response nothing declares, a request
into a receiver that whitelists nothing — is carried, ignored and removed by no
one, so it is counted on one line instead. `--format json` carries every row,
each with its `direction` (`request`, `response` or `payload`) and whether it is
`dropped`.

### `flowatlas config [selector]`

The settings one flow depends on, across every service it reaches, including the
ones no controller mentions. The selector names an entry the same way `flow`
does.

| Flag | Default | Does |
|---|---|---|
| `--all` | off | every key in the project, grouped by service |
| `--service <name>` | every service | narrow to one |

### `flowatlas hotspots`

The nodes the most things point at: where a change is felt.

| Flag | Default | Does |
|---|---|---|
| `--top <n>` | `20` | how many to rank |
| `--type <nodeType>` | every type | only this kind of node. Repeatable |
| `--edge <edgeType>` | `calls`, `http_calls`, `hits`, `consumes`, `injects` | which edges count. Repeatable |
| `--cross-service` | off | rank by how many services reach it, not how many edges |

### `flowatlas visualise`

Writes the whole graph as one self-contained page. Also spelled `visualize`.

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | found from the working directory | configuration to read the graph of |
| `--db <path>` | the configured one | database to read instead |
| `--out <file>` | `graph.html` next to the configuration | where to write it; the working directory when only `--db` is given |
| `--title <name>` | the folder holding the configuration | what to call the project on the page |
| `--editor-links <editor>` | off | make every `file:line` on the page a link that opens it: `vscode`, `cursor`, `idea` or `file`. **Writes each repository's absolute local path into the page**; needs the configuration |
| `--diff <ref>` | off | add a Changes tab: what the working tree changes against this ref, read the way `flowatlas diff` reads it |
| `--observed-diff <a> <b>` | off | add a Run time changes tab comparing two observed files, before then after (read, never written) |
| `--min-count <n>` | 20 | with `--observed-diff`, the fewest requests both files must have seen before a time or a failure share is compared |

No server and nothing to install. Two typefaces come from Google Fonts, with a
fallback, so the page reads offline but is not free of a third party. The page opens on the
Map with its tabs on screen, lists every way in, follows any one of them across service
boundaries, and has a tab each for every crossing and for everything that did not
join. The tabs are Map, Steps, Crossings, Not joined, Busiest, Traces (only
when the observed file kept sample requests), Changes (only with `--diff`), Run
time changes (only with `--observed-diff`) and Graph; their row stays at the top of the window while the tab
scrolls, and on a narrow screen the tabs come before the ways in.

**The strip** at the top is the project's name and a pill per figure: how many
repositories were read, the graph's size, service calls and browser calls joined,
routes reached, channels joined, *Missed*, and what was seen at run time once
`flowatlas observe` has run. A pill's title says what it means, and so does the
line under the strip while the pill is focused or clicked. A pill whose total is
nought is not drawn (no "0 / 0 joined" on a project with no front end), except
*Missed* and what was read, where nought is the news. Beside them, when the page was
built, and *build · <total>ms · <n> services*, which folds out each service's time,
slowest first. The sentence that once stood under the name is now at the foot of
the page.

**The service rail** under the strip hides a service everywhere: its ways in, and
its nodes on the Graph tab. Up to twelve services it is a chip each; past twelve it
is one *Services: all* button (*Services: 3 of 30* when some are hidden) opening a
checklist with a search box, *All* and *None* (for the services the search lists),
and each service's type, node count and colour.

**Start here.** On a first visit - an address naming no tab - a card above the Map
names three things worth opening, each worked out from the graph in hand and each a
link: the *busiest way in* (the one that crosses into other services most often,
then the one with the most steps; it opens in Steps), the *worst gap* (the gap with
the most problems to fix; it opens Not joined on that row), and, with `--diff`, the
*latest change* (a removed route still called, else the first route added). Its
close button keeps it closed in this browser; *Start here* in the strip brings it
back.

The graph is packed into the page with every repeated string shipped once:
node types, files and services, and also a failure that stands in front of many
routes (a guard's 401, a pipe's 400, a shared service's 404), which is one
record every route it guards points at, and a log line's level and template.
The page is still one readable file; its data is plain JSON in a `<script>`
block.

**One search box**, beside the service rail, finds a route or other way in, a channel, a
table, a type, a gap (by its message, its reason in words, or the reason's code) or a
class by name, under *Fails with* the ways in that can fail with an exception or a
status (`NotFoundException`, `404`), and under *Nodes* every node, by label, type,
kind, service or file (`table orders`
is the table called `orders`). It is the only search on the page: `/` reaches it from
anywhere but a field, the arrows move through what it found, Enter goes, and Escape
clears it and hands the keyboard back. A hit goes to where it is **in the tab that is
open, when that tab can show it**: a way in is picked on the left, the list scrolls
to it, and Steps or the Map open it (the Map selects its service); a node
on the Graph tab is focused there; a gap opens Not joined on its row. Anything else
opens the Graph on it. Where it lands is marked - a strong ring and an accent ground
that fade after two seconds - and Back returns from it. Its last item, *Filter the
Ways in list to '…'*, filters the list by path, name or service, which a chip over
the list then says (*filtered: orders ×*), with a note when the way in picked is one
it hides. On the Graph tab the box also picks a path's end (see below).

**Words, not codes.** The page says a check row's reason, an edge's type and how far
an edge is trusted in words - *route not found on the target*, *requests*, *best
guess* - with the code in the tooltip, and the details panel prints a row's reason
code beside it to copy. Copy as prompt, links and the MCP server keep the codes. An
edge read from code says nothing about its trust; only *annotated*, *declared*, *best
guess* and *seen at run time* are said. Steps no longer marks every row *certain*, so
the one guess on a way in stands out.

**Keys and commands.** `?` lists every key the page answers, by where it works, from
the same table the handlers read. ⌘K (Ctrl+K) opens a command list: every tab, the
open tab's actions (full screen, Types on or off, SVG and PNG export, copy link, copy
as prompt for the way in picked, problems, filters), and *Search for '…'*, which hands
what was typed to the search. Arrows, Enter and Escape work it, and on a phone it is
a sheet the width of the window. Crossings, Busiest and Changes, which never read the
way in picked, hide the Ways in list and take the width.

**Keyboard, screen reader, theme.** The tab row is a tablist: Tab reaches the open
tab, ← and → open the one before or after, Home and End the ends. In the Ways in
list Tab reaches one row and ↓ ↑ Home End move between them; the list draws only the
rows in sight, however many ways in there are, and always the one picked. The *Theme*
button in the strip turns the colours from the system's (*Auto*) to *Light* to *Dark*
and back, remembered by the browser (where it keeps nothing, each load follows the
system); the command list offers it too. Every text colour reads at 4.5:1 or more in
both themes, and no text is under 12px outside the drawings.

**On a phone.** The tab row scrolls sideways inside itself, faded where it goes on;
under 360px a *View* select stands in for it. The Map tab lists its boxes as cards
under their call-order columns, each with what it reaches and what reaches it; a card
opens the box's details under it, and *Show the drawing* draws the map (*Show as a
list* goes back). Addresses are the same as the drawing's.

The **Map** tab is the whole project at the size of its services:

- **Layout.** *call order*, the default, puts services in columns by how far
  they sit from the front ends along the calls (*step 1*, *step 2*, …), with queues and topics as their
  own boxes between the columns and each service's stores and outside hosts
  under it, one box per outside host however many call it, capped with
  `+n more`. Hovering a box dims everything it does not touch. *by role* is the
  layout described next.
- **Boxes.** One per service, in a column by what it is for, left to right as a
  request travels: front ends (screens, no routes), APIs and ways in (routes,
  bot commands, procedures), channels, workers and workflows (reached only by
  messages, schedules, invokes or workflows), libraries (reached by nothing but
  the code that imports them), data (a service's tables, one box beside it), the
  outside (APIs on other hosts), and packages. A channel is a box of its own, so
  a channel with no consumer, or no producer, shows as a dead end.
- **Links.** Every edge whose two ends belong to different boxes is part of the
  link between them, merged by kind - requests, messages, workflow starts,
  function invokes, queries, outside calls, calls - and counted. A link is as
  thick as the edges it stands for and dashed when any of them is `heuristic`.
  Guards, imports and settings keys are not links.
- **Families.** Services in one column whose names share a prefix - the longest
  one three or more of them share, written as they write it (`pay-api-*`,
  `core.jobs.*`) - are a family; channels are a family by what carries them, and
  packages by their scope. A family is one stacked box until it is opened; on a
  map of more than forty boxes every family starts closed. An open family is
  framed, its name closes it, and one of more than fourteen wraps into a block.
  *Open all* and *Close all* do every family. Within a column, boxes are ordered
  by where what they touch sits, a few sweeps each way, so the same graph always
  draws the same map.
- **Details.** A box opens its details: a service's counts, ways in by kind
  (a front end's screen actions among them, as on the Ways in list; a front end
  with none read says how many screens it has rather than *0 ways in*),
  problems to fix, routes nothing calls, what it reaches and what reaches it,
  its ways in (each opening in the Graph tab), its busiest classes, and what it
  is built from. A link lists the edges it stands for, each end opening in the
  Graph tab. *Open in Graph* centres the Graph tab on the box. Double-click, or
  *Only this and what it touches*, draws one box and its neighbours.
- **Packages.** A layer, off by default, from each service's `package.json`,
  which `build` records in the link report (`services[].packages`: its name, and
  what it needs at run time and for development). A service depending on the
  package another service publishes is joined to that service; a package two
  or more services use is a box, with a link from each; development
  dependencies are drawn on request. A package nobody installed is named the
  same as one that is.
- **Checks.** *check* marks, per box: problems to fix, channels with one end,
  routes nothing calls, services nothing could read, or services that reach
  each other at run time (a cycle, its links drawn red). The chips hide a kind
  of link.
- **The frame.** Drag pans; ctrl (⌘ on a Mac) and the wheel, or a pinch,
  zooms; a plain wheel scrolls the page past the map, saying once in the
  corner how to zoom instead, and pans it only in full screen. *Fit* shows it
  all; `F` or the button is full screen; Escape closes the details, then a
  one-box view, then full screen. The address keeps the view by name -
  `#map/s=<box>&l=<link>&f=<box>&t=<families toggled>&h=<kinds hidden>&m=<check>&p=1&d=1` -
  so a link opens the same view in the next build; a box it names that is gone
  is said. *Copy link*, and SVG and PNG export, as on the Graph tab.

The **Graph** tab draws the neighbourhood of one node rather than the whole
graph, which on a real project is far too many boxes to say anything:

- **Choosing a focus.** The one search's *Nodes* finds any node, and on this tab
  a hit is focused here. Every way in on the left, and every node named in the
  Steps, Crossings and Not joined tabs, has a *show in graph* link beside it.
- **The bar is one row.** *Back*, *Forward* and the hops, then *Filters* (edge
  types, trust and plumbing, the most nodes drawn) and *Check* (*Problems*,
  *problems only*, a path's ends, its direction and depth) as popovers, each
  saying how much of it is on (*Filters · 2*, *Check · 1*), then the tools.
  The answer area under the bar is there only when there is an answer.
- **The drawing.** The focus in the middle, what reaches it to the left and what
  it reaches to the right, one column per hop (one, two or three; two by
  default). Every service is a faint band across the drawing with its name in
  the corner, the focus's service first, so an edge that leaves a band is a
  crossing; the edge takes the colour of the service it enters. Nodes are marked
  by type; tables, channels, outside APIs and settings are drawn round. A node
  is written as what it is, strong, over whose it is, muted: `list` over
  `OrdersService`, a route's address over the controller that handles it. Long
  names are shortened in the middle, so a path keeps its verb and its last
  segment; hovering a node gives the full name, its service and `file:line`.
  An edge is solid when it was read from the code (`static`), dashed when it was
  guessed (`heuristic`, *best guess*), and dotted when an annotation or a document said so
  (`marker`, *annotated*; `declared`). An edge says what it does (*calls*, *requests*,
  *publishes*) only when hovered and around the open node, so a busy drawing is lines
  rather than words.
- **Plumbing is folded.** Guards, interceptors, pipes and middleware are not
  drawn as nodes: a way in carries a chip saying what runs in front of it
  (`2 guards · 3 interceptors · 1 pipe`). Clicking the chip, or `W` on the node,
  draws that chain beside it and folds it back again; the *plumbing* chip under
  *Filters* draws all of it as ordinary nodes. A guard chosen as the focus
  shows the ways in it stands in front of.
- **Busy sides are grouped.** More than six neighbours of one type on one side
  of a node (the queries on a table, the publishers on a channel, the callers of
  a route) are drawn as groups: by service, then by the class that owns them,
  each a stack with its count. A level with more than eight groups shows the
  busiest seven and one group holding the rest. Clicking a group opens it in
  place, into its classes and then into its nodes; *Group again* under the
  drawing closes them all. Grouping comes before the cap, so a table with two
  hundred queries is a handful of groups, not one long "N more". What lies past a
  closed group within the hops is counted under the drawing and drawn once the
  group is open.
- **Hover shows the way.** Hovering a node, or moving the keys onto it, lights
  the way the walk took from the focus to it and dims everything else.
- **Zoom shows what it can.** Far out, a node is its service's colour and its
  shape; nearer, its name; close, everything. While the drawing is bigger than
  the screen a minimap in the corner shows all of it and where the view is;
  clicking or dragging on it moves there. It keeps to a small box in the corner
  whatever the drawing's shape, so it never sits over a column of nodes.
- **The cap is said, never silent.** At most 30, 60, 120 or 250 nodes are drawn
  around a focus. The line under the drawing says how many more there are within
  the hops, and a node with more of the flow not drawn carries `+N`; clicking
  it, `+`, or *Expand* in the panel, draws them.
- **Expanding keeps to the flow.** The focus looks both ways; a node to its
  right looks only further right and a node to its left only further left, and
  expanding a node goes on the same way: a node on the right adds what it
  reaches (calls, queries, emits, requests, …), a node on the left what reaches
  it, and the focus both. The panel's button says which (*Expand: what it
  reaches*, *Expand: what reaches it*). A node reached through a group follows
  the side it is drawn on. `+N` counts only that way, so a shared helper whose
  only undrawn neighbours are its other callers carries no `+N`.
- **Who else uses this.** The other way from a node - the other callers of a
  helper on the right, the other callees of a caller on the left - is not the
  flow, and is drawn only when asked for: by the node's *used by N others* (or
  *uses N others*) badge, by `O`, or by *Who else uses this* (*What else it
  uses*) in the panel, which says how many there are. They are drawn as
  context: faded, in dashed boxes, with *also uses parseRole* (or *also used by
  …*) where the owner would be, on faded lines, grouped by service and class as
  a busy side is, so a helper used by ninety methods is a few groups. They do
  not expand; *Centre here* follows one. The line under the drawing counts them
  apart.
- **What it takes and gives back.** *Types* above the drawing, or `T`, writes a
  third line under every node: a method's parameters and what it returns
  (`(dto: CreateOrder, note?: string) → Order`), a route's request parts and
  response (`body: CreateOrder · params: { id: string } → Order`), what a call
  sends and expects back, what a producer emits and a channel carries. Long
  lines are shortened in the middle; the hover card gives the whole. A method or call
  whose types were not read says *types not recorded*. The setting is kept in
  the browser, not in the link. Every reader records them: NestJS, Express,
  Fastify, Koa and Lambda methods and functions, Angular methods and
  components (its inputs as what it takes, its outputs as what it gives back:
  `(order: OrderDto, dense?: boolean) → {opened: OrderDto}`; a directive the
  same way, a pipe as its `transform`; the details panel also lists what a
  directive or component binds on its element - `host` entries, `@HostBinding`
  and `@HostListener` members, as `[class.active]=isActive` and
  `(click)=toggle($event)`, with each method a listener calls as a node it
  links to (`hostMembers`; click one to centre on it) - the name it is
  exported as (`exportAs`), and whether a pipe is `pure`), React components,
  hooks and functions, tRPC procedures (the input its schema checks, and what
  its resolver answers), routes, typed calls and payloads. A way in
  that is not a request - a template event, a bot command, a consumer - shows
  what it hands the function that answers it (`onSave(order: Order) → void`).
- **The hover card.** Resting the pointer on a node, or moving the keys onto
  one, shows a card beside it with its full name, owner, service and
  `file:line`, what it takes and gives back (a function on one line while it
  fits, else a parameter to a line; a route's request parts and response; what
  a call sends and expects back; a channel's payload), and one level of each
  type it names: up to four types of eight rows each, the rest counted. A node
  whose types were not read says so. Resting on a type in the details panel
  peeks at its fields the same way without opening it. The card works with
  *Types* on or off, keeps inside the window, goes on Escape, a scroll, a pan
  or a zoom, and never shows on a touch, where a tap opens the details.
  The pointer can move onto the card and stay; past a height it scrolls. What
  it counted is shown there on a click — *+12 more — show* lists every row of
  that type, *… N more lines — show* the rest of the face, *N more types —
  show* the types it left out — up to 200 rows a card, past which it says the
  rest is in the details. Clicking a type's name on the card opens the details
  with that type open; clicking the card's title, or the node while its card
  is up (or Enter on it from the keys), opens the details with every type the
  card showed open one level.
- **The details panel.** Clicking a node opens its type, kind, label, service,
  `file:line` and the metadata the graph holds for it (verb and path, table,
  channel kind, deployed name, which reader read it and how its name was read),
  its edges in and out grouped by type with the far node's service and the
  edge's confidence, and its problems: the rows that name it, with their reasons
  and hints, the rows that name no node but sit at its line, said apart, and
  below them the rows elsewhere in its file. Above the edges, what the node takes
  and gives back, named as the face line is: each named type is a link that
  opens its fields underneath, an enum its values and a union its members, as
  deep as asked, and says where it is declared; a type from a dependency says
  so rather than opening. *expand all* on a row, or `E` on a type, opens
  everything under it at once, and the section's *Expand all* every row of it;
  a type already open above it is marked `↻ Name — see above` instead of
  opening again. One opening stops at six levels or three hundred rows and says
  how many types it left closed; asking there again opens the next stretch.
  *Collapse all* closes them, and *Copy as TypeScript* copies the same face
  with every type written out inline (`function create(dto: { // CreateOrder …
  }): { // Order … };`, a route as `type Request` and `type Response`), within
  the same bounds, a type inside itself kept as its name. From it: *Centre here*, *Expand*,
  *Who else uses this* with its count, *Steps* (above the drawing) and *Open in Steps* for a way in,
  *Path from here*, *Path to here* and
  *Impact*. Clicking a node in its lists walks on to it.
- **Problems.** A node carrying rows is badged with the count on its top edge,
  red for rows naming it and amber for rows at its line, counted apart; a group
  carries its members' badges summed, so a closed group still says it holds
  problems. The same badges, drawn on every view - the neighbourhood, a path,
  an impact - are said in words at the top of the details panel. *Problems only* cuts the drawing down to
  the nodes with problems and the steps that join them to the focus, and says
  how many it hid. The *Problems* button lists, in one place, the ways in with
  rows or with no handler read, the crossings with rows at either end, and the
  calls that joined nothing or carry rows, each with *show in graph*.
- **A path between two nodes.** Choose the two ends with *Path from here* and
  *Path to here* in the panel, or with *from* and *to* under *Check*, which hand
  the keyboard to the one search: every hit is then a node to end the path on. Every shortest path is drawn, one column per step, with how many there
  are; past the cap one whole path is drawn first. The edges are followed the
  way the calls run unless *either way* is pressed, within 6, 12 or 24 steps,
  through what the filters let through (the two ends always count). With no
  path the page says so, and what it searched: the steps, the direction, the
  filters and how many nodes it reached.
- **Impact.** *Impact* in the panel draws everything upstream of a node, to the
  ways in that reach it, and lists the entry points and the screen actions among
  them, nearest first. It is `flowatlas impact` drawn: the same edges, the same
  eight hops lengthened by the workflow steps it climbs, no filter, and a test
  holds the two to the same answer on the fixtures. Past the cap, every way in is
  drawn first with one chain from it down to the node. *Back to the
  neighbourhood* leaves a path or an impact; so does *Back*. A path and an
  impact draw every node on them rather than grouping, and fold plumbing into
  the same chips the neighbourhood does.
- **Editor links.** With `--editor-links`, the `file:line` in the panel and on
  every row opens the file in that editor: `vscode://file/<path>:<line>`,
  `cursor://file/<path>:<line>`, `idea://open?file=<path>&line=<line>`, or
  `file://<path>` with no line. Off by default, because it writes each
  repository's absolute local path into the page, which is then no longer one
  to send to somebody else.
- **Moving around.** Drag to pan, pinch or ctrl+scroll (⌘ on a Mac) to zoom;
  a plain scroll moves the page, and pans the drawing only in full screen.
  *Fit* to see it all. Double-click centres on a node. Arrow keys move between drawn
  nodes, a hop at a time to the side and within a column up and down; Enter
  opens a node or a group, `+` expands it, `O` draws who else uses it, `W`
  unfolds its plumbing. On a
  touch screen one
  finger pans, and two fingers pan and pinch to zoom. *Back* and *Forward* step
  through the focuses visited.
- **Full screen.** *Full screen*, or `F`, gives the drawing the whole window:
  the heading, the numbers, the service rail and the ways in step aside, and the
  details panel lays over the drawing from the right.
- **Escape closes one thing at a time, nearest first**: an open *Filters* or
  *Check* popover (or picking a path's end), then the details panel - the drawer
  in full screen - then the *Problems* list, a half-chosen path, and a path or
  impact answer, back to the neighbourhood, and last full screen.
- **The details panel** widens or narrows by dragging its left edge, or with the
  arrow keys once its edge has focus (`Home` and `End` for the narrowest and
  widest), and folds to a narrow rail with the tab on its edge; the rail still
  names the open node, and clicking it unfolds the panel. The width and the fold
  are kept in the browser, not in the page.
- **Links that last.** The view is in the address,
  `graph.html#graph/<key>/<hops>/<expanded>.<expanded>/<question>/<hidden>/<also>.<also>`,
  so it can be bookmarked or sent with the file. The last three appear only when
  they, or one after them, say something: the question is `impact`, `path.<key>.<steps>` (with
  `.either` when edges are walked either way) from the focus, or `only` for
  *problems only*; what the filters hide is listed by name, `s:<service>`,
  `e:<edge type>` and `t:<trust>`, so it reads the same in the next build. A
  link without them leaves the filters as the person has them. `<also>` names
  the nodes whose *who else uses this* is drawn. An expanded node is expanded
  in the flow, so a link made when expanding drew both ways opens with the same
  nodes expanded, keeping to the flow. A node is named by a key of six letters and digits
  hashed from its graph id, the same in every build, so a link made today opens
  the same node in tomorrow's page even though nodes were added and removed
  around it. When two ids hash to the same key, which the command checks as it
  writes the page, each takes a longer key of its own, and a link carrying the
  short key they share - one made before the second node existed - offers both
  rather than opening either. A link made before keys names a node by its
  position in the page; it still opens whatever sits there, and the page says
  so. A key the page does not
  hold - a node removed or renamed since - is said over the drawing, not
  guessed at. *Copy link* copies the address of what is on screen.
- **Pictures.** *SVG* and *PNG* save the drawing as it stands - the
  neighbourhood, the selection, the filters - at its own size rather than the
  window's, in the theme on screen. A picture is at full detail whatever the
  zoom, with every name, count and badge, and leaves the minimap out. The PNG is the SVG drawn onto a canvas in
  the page, at twice its size where the browser allows, so nothing is sent
  anywhere. Without the page's typefaces loaded, a picture falls back to the
  system's monospace.
- **Filters.** The service rail at the top (or its checklist, past twelve
  services) hides a service's nodes here as it does its ways in; chips hide an edge type or a confidence, so the drawing can
  show, for instance, only what was guessed. The line under the drawing says
  which filters are on.

The **Steps** tab is one way in as a list, in the order the code calls things
(source order, not time), indented by depth: the handler, the services it calls,
the tables, addresses and channels they reach, and the next service's way in.
Clicking a way in on the left opens it here from any tab but the Graph. It is
the page's one view of a way in: an older `#walk/<key>` link opens here on the
same way in.

- **Compact, detailed, waterfall.** A switch on the bar draws the steps three
  ways, and the page remembers the choice in this browser (compact when it
  cannot). *Compact* is a line per step: its kind, its name, the file by its
  name (the path from the repository root in the tooltip) and only the marks that
  change the reading - *best guess*, *on failure*, *per item*, *likely N+1*,
  *throws*, why a chain breaks, *seen ×n*, and *listed above* or *loops back* on a
  repeat. *Detailed* adds every other mark (*annotated*, *side by side*, a stand-in's
  types), the full path, the table, address or channel inline, the lines a step
  logs, and the settings a step reads (`cfg`), each a leaf under the step that
  reads it. *Waterfall* draws a bar per step in its service's colour, under its
  parent: a step nothing runs under is one unit wide, a parent as wide as what
  runs under it, children end to end in call order and side-by-side ones from the
  same place. Its axis says *steps, not time*: the widths show what runs inside
  and beside what, never how long. A repeat, a loop, an answer or a break is a
  mark of no width. When `flowatlas observe` measured times, the waterfall is
  drawn in milliseconds instead: each step as long as its typical figure (the
  join into it, else its own span), *p50* or *p95* by a switch on the bar (kept
  in this browser). What a step calls sits inside its bar: the first call
  starts where the step starts (so a chain of nested steps starts together),
  the next after it, side-by-side ones from one place, and a parent is at least
  as long as what runs inside it. The axis says *typical time per step (p50), not one
  request*, since typical times drawn this way are a shape, not a latency, and
  its tick labels stay on one line inside the axis, the last one written up to
  its place at the right edge; a step
  with no figure keeps a small hatched stand-in, and its tooltip says so. A
  step where more than one request in a hundred failed carries *n% errors*. The steps above the Graph tab's drawing follow the same
  switch, and the command list (⌘K) offers it on this tab.
- **Rows.** Each step has a kind mark - `in` handler, `view` screen, `act` user
  action, `fn` service, `db` store, `http` outbound call, `ch` queue or topic,
  `λ` function, `wf` workflow, `cfg` reads config - in one neutral chip, the
  service being the colour of the rule along the row; the legend lists them all.
  Where a way in leaves one service for another a row of its own says so between
  the call and what answers it, in the colour of the service it enters: *→
  orders · requests*, with the edge's trust only when it is not read from code.
  Guards are said under the step they stand in front of (*runs first AuthGuard,
  RolesGuard*). Calls inside `Promise.all` and its kin are marked *side by
  side*; a call run once per item of a loop is marked *per item*, and a query,
  request or publish there *likely N+1* unless the loop is per item on purpose
  or bounded (P89). The **Busiest** tab lists the likely N+1 loops under the
  methods, most-reached first. A failure path (`when: failure`, an
  error answer, a destination on failure) is red, and so is the row where a
  chain breaks: a request that finds no route, a way in with no handler read,
  an address that was not read. A join that was a best guess says so.
- **What it can fail with.** The heading lists what the way in can fail with,
  by status and exception, and so do the ways-in list and the details panel;
  the step that throws is marked. The details panel lists each status and
  exception once with how many places raise it, the places behind a
  disclosure, and a status nothing on the path writes as `500?`. With an
  observed file beside the graph (P106), each declared status says what
  traffic answered: `404 seen ×3`, or `409 never seen` for a way in hit at
  least 20 times in the window; and each status from 400 up that it answered
  and no failure declares is a chip of its own, `500 ×4 not declared`, drawn
  quieter where the framework answers it anyway (the router's 404, a 401 or
  403 from a check in front of it, a 400 for a body it cannot read) with the
  reason on hover. The details panel lists the same under the declared ones,
  with the window they are over. A scheduled way in shows its expression and the zone it fires in.
  A step's log lines are folded under it, as templates.
- **Moving around.** Hovering a row lights its node in the Graph tab's
  drawing, where a way in's steps also open above the drawing; a row opens its
  `file:line` and *show in graph*. The depth goes to
  4, 8, 12 or 24 steps (12 to start); a list holds 300 rows. The line under
  the last row says which of the two left steps out: *past depth 12: raise the
  depth*, or *past the first 300 rows* with a button that shows 300 more.
- **Copy as prompt** copies the way in as Markdown for an assistant: what is in
  front of it, what it can fail with and, with an observed file, what it was
  seen failing with (P106), its schedule, the steps `get_flow` walks
  with their ids, repo-relative `file:line` and marks, shapes in and out, log
  lines, open gaps with their reasons, and the graph server's calls to make
  next. No source code. The same button is on a channel and on a check row,
  and the graph server's `describe_for_prompt` writes the same text, character
  for character (P97): a check row is copied as its gap id, which the tool
  takes. The details panel copies any node, and its `⋯` the node's class,
  file or service; a service's box on the Map copies the service: the
  `class`, `file` and `service` scopes of `describe_for_prompt`, the same
  text again (P134).

The **Not joined** tab is split by what a row is, as the pack says it (P81's
row kinds and core's `riskOf`), never by the words in a reason. Three
sections, in this order, each with its count and a sentence on what would
appear when it is empty:

1. **Couldn't join**: gaps, the calls, imports and addresses the reader could
   not join to what answers them, by reason. *By cause and package* is folded
   under them (see below).
2. **Risks**: findings about the code itself, grouped *who may ask* (auth:
   `route-unguarded`, `route-shadowed`, a public marker with no reason), then
   *likely N+1 and cost* (`query-in-loop`), then *wired wrong or meeting
   nothing* (two declarations of one route, an end nothing meets). A row's
   tone is its risk's.
3. **Accepted**: the rows accepted with `flowatlas accept`, each rule once with
   how many rows it took, then every accepted row with its note (folded past
   ten rows). The counts above leave them out.

Notes (how a join or a reading was made, with nothing missed) are not listed;
one line says how many there are, and `flowatlas doctor` lists them. Every row
is in one section, the accepted list or that line, and a reason is listed once.
The strip above the page says the same figures the build line does: *Missed*,
with "joined from files" (notes) and "findings" under it, counted from the
rows, so a database built by 0.5.x still shows them.

Each reason is a row that opens: the summary is the reason in words (the code
in its tooltip), its count and its first place; opened, it lists every place
it stands for (service, `file:line`, message, *show in graph*), fifty at most,
then `flowatlas doctor --reason <code> --max-nodes <n>` for the rest, with
`--service <name>` when every row of the reason is in one service: a command
that lists every place of that reason and no other (`--reason` runs the
`unresolved` and `desync` sections, both narrowed to it). Each row and each place
has one `⋯` menu (keyboard: Enter opens it, the arrows move, Enter runs, Escape
closes and hands the keyboard back):

- *Copy as prompt*, the row as Markdown for an assistant;
- *Copy accept command*, the `flowatlas accept` command for this place: a
  route row by its route exactly (`--path 'GET /orders/:param'`), any other row
  by its file (`--file`; `accept` matches a file, never a line, so it holds
  through an edit above it). A row with no single place names only its
  service, and the menu warns that it then takes the reason across it;
- *Copy accept command for every row like this*, only where a rule takes more
  than the place: the routes beside it (`likeRoute`, `GET /orders/*`) or the
  files beside it (`src/orders/*`). It always ends in `--dry-run`, so run as it
  is it lists what it would take and writes nothing.

The menu says it copies a command to run in the project; the page is a file
and writes nothing. What was copied is shown in a toast. The rows a node's
details panel lists on the Graph tab have the same menu.

*By cause and package*, under Couldn't join, groups what the reader could
not follow by cause and then by package, as `doctor --unresolved` does: one
part per cause with its hint and a few places, each with *show in graph*, and a
table by package. Once `flowatlas observe` has run, *seen at run time, not
found in code* lists the spans no code accounts for, and *seen at run time,
could be more than one place* the ones that fit several places and were
counted on none, each with its candidates; both come first in the *Problems*
answer.

The **Busiest** tab ranks the methods most things lean on, the way
`flowatlas hotspots` ranks them, with how many ways in reach each, how far the
nearest one is, and its edges from its own service against all of them.

The **Changes** tab, with `--diff <ref>`, is what `flowatlas diff` found: routes
added and removed, the removed routes something on the head side still calls
and who calls them, declarations whose shape moved and the fields that moved,
new contract findings, and the unresolved count on each side.

What `flowatlas observe` saw is on the page too, when it has run: a seen count
on each way in and each step, and thicker Map links where traffic went. With
P105's timings it also gives each way in and each step its *p95* and its error
rate (above 1%), the header says the hours the figures cover (*seen 2025-10-16
07:00 to 09:00 UTC*), and the Map bar gets a *heat* switch: *off*, *traffic*
(the requests through each link) or *p95* (the slowest edge behind each link,
never an average). One sequential ramp colours the links in both themes, a key
under the map gives its two ends and the window, and a link nothing was seen on
stays quiet. The heat is in the map's address (`#map/x=p95`). The copied prompt
and `describe_for_prompt` write the same figures beside a step's *seen ×n*.

The **Traces** tab, when the observed file kept samples, lists each way in's
slowest request and its latest failing one, slowest first, and draws the one
picked as a tree of its spans on its own time axis: when each began after the
request did and how long it took. A span the map has a node for links to it; one
it has not says *not in the map*; spans past the sample's cap are counted. The
page holds no trace id, span id or time of day, only shapes with timings.

The **Run time changes** tab, with `--observed-diff <a> <b>`, compares two
observed files: what got slower (p95 up by a tenth and a millisecond), what
fails more (one request in a hundred more, or a new 5xx), what was seen only in
the second and what only in the first, each row opening its way in on Steps.
Both windows are shown; a time or a share is compared only where both files saw
`--min-count` requests (20), and ids the graph no longer holds are left out and
counted. `flowatlas observe --diff <a> <b>` prints the same without a page.

**Every tab has an address.** `#map…` and `#graph/…` keep the grammars described
above; every other tab is `#<tab>`, with the way in for Steps, the one that
shows one, and where in the tab to go after it:

| Address | Opens |
|---|---|
| `#steps/<key>` (and an older `#walk/<key>`) | Steps on the way in whose node key is `<key>` |
| `#crossings`, `#busiest`, `#traces`, `#changes`, `#runtime` | that tab |
| `#missing`, `#missing/reason=<reason>` | Not joined, at that reason's row, opened to its places |
| `#graph` | the Graph tab, on the way in picked |

Any of them takes a way in (`#crossings/<key>`), which becomes the one picked.
Moving between tabs rewrites the address without adding to the browser's history;
picking another way in adds to it, so *Back* returns to the way in before. *Copy
link* on Steps and the table tabs copies the address of what is on screen. A
link naming a tab this page does not have (`#changes` on a page written without
`--diff`), a way in it does not hold, or a reason with no rows here opens what the
page has and says so above the tab.

A link carries the page's own address, which for a file on disk is that file's
path: it opens on the machine that has the file, at that path.

### `flowatlas observe <file...>`

Lays trace files you already have over the built graph and adds them to
`.flowatlas/observed.json` beside `graph.db`: which joins real traffic went
through, how often each way in was hit, how long each took and how it
answered, and what ran that the code does not show. Local only: it reads the
files named and sends nothing anywhere.

```
$ flowatlas observe traces/checkout.otlp.json traces/billing.observe.json traces/billing.batches.observe.json traces/orders.observe.json
77 spans read from 4 file(s)
4 joins seen, 6 entries hit, 3 seen at run time but not found in code, 1 that could be more than one place
  db        billing  invoices  (2)
  http      gateway  GET /metrics  (1)
  messaging orders  order.audited  (1)
could be more than one place, so counted on none:
  client    gateway  GET /orders/:value  (1)
    any of http_out:gateway#src/clients/orders.client.ts:33:12, http_out:gateway#src/clients/orders.client.ts:59:12
slowest entries (p95):
  gateway GET /orders/:param  count 2  p50 47.26ms  p95 520ms  max 520ms  errors 0%
  orders GET /orders/:param  count 2  p50 1.04ms  p95 496ms  max 496ms  errors 0%
  orders POST /orders  count 1  p50 35ms  p95 35ms  max 35ms  errors 100%
  billing event order.created  count 2  p50 0.96ms  p95 12ms  max 12ms  errors 0%
  billing POST /invoices  count 22  p50 8.35ms  p95 11.81ms  max 41.5ms  errors 4.6%
failing most:
  orders POST /orders  count 1  p50 35ms  p95 35ms  max 35ms  errors 100%
  billing POST /invoices  count 22  p50 8.35ms  p95 11.81ms  max 41.5ms  errors 4.6%
window 2025-10-16T07:00:00.000Z to 2025-10-16T09:00:00.000Z; 0 files skipped as already read
.flowatlas/observed.json
```

Six ways a trace file can be written, and four AWS exports (see
[AWS exports](#aws-exports-without-a-collector) below), each picked by looking
at the file, and any of them may be gzipped (a file that starts with gzip's
magic bytes is unpacked first, so a body captured from a POST is read as it
is). A quoted glob (`'traces/**/*.json'`) is the files it matches, for a
shell that does not expand `**`, and one that matches nothing is an error. A
directory is what an end-to-end test run left (P205): every `*.har` and
`*.har.gz` under it, and every `.zip` that holds a HAR (Playwright's
`recordHar` with a `.zip` path), are read; everything else in it - videos,
screenshots, Playwright's own `trace.zip`, the bodies a HAR attached,
`.last-run.json`, trace files of other formats - is left alone and counted
(`left alone in test-results: 6 files that are not HAR`), and a directory
with no HAR in it is an error. Name a trace file of another format on its
own, or with a glob. [Run time in five minutes](run-time.md) is the recipe.

- **OTLP/JSON** (`resourceSpans` / `scopeSpans` / `spans`, one document or one
  per line). Read: `service.name`, span kind, `http.request.method` /
  `http.method`, `http.route`, the path of `url.full` / `http.url`,
  `http.response.status_code` / `http.status_code`, `messaging.destination.name`,
  `code.namespace` + `code.function` (or `code.function.name`),
  `db.collection.name`, `rpc.service` / `rpc.method`, the start and end time
  (to the nanosecond), and whether `status.code` is an error; and on AWS the
  names listed under *On AWS Lambda* below (`faas.*`, `cloud.resource_id`,
  `rpc.system`, `messaging.system`, `aws.*`), `aws.dynamodb.table_names` as a
  list.
- **OTLP protobuf**, an `ExportTraceServiceRequest` as the collector's file
  exporter or an OTLP/HTTP body writes it. A `.pb`, `.binpb` or `.protobuf`
  file is read as protobuf first; any other file is, when it is not JSON. The
  same keys are read; every other attribute is skipped as bytes while the
  request is walked, never decoded, and so are span names, events and the
  status message. A request that is cut short says where:
  `traces/x.pb is not an OTLP trace request (byte 1832)`.
- **@nestjs/observe** telemetry batches, the JSON the SDK posts (gzipped) to
  `<endpoint>/applications/telemetry`: `{ serviceId, snapshots, jobs, ... }`,
  a saved series of posts `{ batches: [ ... ] }` (read one after another), or
  a bare array of request snapshots exported by hand. The reader was checked
  against the SDK's own wire contract in **0.3.12** (P202); a newer version is
  read the same way, field by field, and a field it adds is dropped unread.
  Read: `serviceId` (else `--service`); per snapshot `ti` trace id, `ct` time
  (ISO), `d` duration (ms), `e` (an error, read as *it failed*), `p` protocol,
  `op` operation, `a.m` method, `a.sc` status and the path of `a.ou`; and the
  span tree in `t`, whose nodes need `o`, `c` and `m` and give `d`, `e` and
  `so` (the start, in ms after the request's) too. What a snapshot is depends
  on its protocol:

  | `p` | Read as |
  |---|---|
  | `http`, `https` | a server span: `op` is the route template Nest matched; a request that matched none carries its URL folded (query cut, UUIDs as `:id`), read as the URL's path shape |
  | `http` with `op` a GraphQL root field (`Query.invoices`) | its span tree only; `a.ou` holds the document, never read |
  | `ws` | a consumer span of the event (`op` is `<Gateway>:<event>`) |
  | `KAFKA`, `NATS`, `REDIS`, `MQTT`, `RMQ` | a consumer span of the topic, subject, channel or pattern in `op`: the channel, its consuming join and the event handler |
  | `TCP`, `GRPC`, a custom transport | a server span of the RPC pattern in `op`, matched to the `@MessagePattern` handler |
  | `graphql` | its span tree only |

  A node of class `http` is an outgoing request (`http.method` and the path of
  `http.url`); one of class `mongodb`, `pg` or `mysql2` names its collection
  or table as the second word of `m`; any other is the method `c.m`. A
  `manual` node is a span the code opened inside a method and names that
  method again, so it is not counted as a call of its own; its children are.
  A node the agent folded (`observe.collapsed: N` in its tags) is N calls,
  each the mean of their summed duration; a folded `http` node keeps none of
  its calls' URLs and is counted as not read. A job is `q` its queue, `c` when
  it ran (ISO), `s` `completed` or `failed` (*it failed*), `d` ms and the same
  tree: a queue's job is a consumer span of the queue, and a scheduled run
  (`q` is `cron`, `interval`, `timeout` or `schedule`) is read for its tree.
  `ti` is the inbound `x-request-id` the agent adopted, or an id it minted -
  never a W3C trace id - and the agent sends it on as `x-request-id` with the
  HTTP calls it records, so the service that answers, read with the same
  agent, reports the same `ti`: its server span, which names no parent, is
  paired with the one client span of that trace in another service with the
  same method and path, and the join is counted as if the parent were named.
  The span ids the reader makes up for a batch name its service, so the two
  services' snapshots of one request each keep their own tree and body (P222).
  `fixtures/multi-repo` has the pair: billing reads the order it invoices from
  orders, and `traces/orders.observe.json` is orders' answer in the same trace.
- **Zipkin v2 JSON** (P112), what the Zipkin UI's *JSON* button and its
  `/api/v2/traces` give: a list of spans, or a list of traces. Read: `traceId`,
  `id`, `parentId`, `kind` (none is internal), `timestamp` and `duration`
  (microseconds), `localEndpoint.serviceName` (else `--service`), and of the
  `tags` the same keys as OTLP's (an OTel SDK's Zipkin exporter writes them)
  plus Brave's `http.path`; an `error` tag, or `otel.status_code: ERROR`, is
  *it failed*, its text never read. Never read: `name`, `annotations`,
  `remoteEndpoint`, the rest of `localEndpoint`, `debug`, `shared`, `sql.query`
  and every other tag.
- **Jaeger JSON** (P112), what the Jaeger UI's *Download JSON* and its query
  API give: `{ data: [{ traceID, spans, processes }] }`, or one trace on its
  own. Read: `traceID`, `spanID`, the parent from the first `CHILD_OF`
  reference (else the first `FOLLOWS_FROM`), `startTime` and `duration`
  (microseconds), the process's `serviceName`, and of the `tags`
  (`{ key, type, value }`, `bool` and `int64` too) `span.kind` and the same
  keys as OTLP's; `error: true` or `otel.status_code: ERROR` is *it failed*.
  Never read: `operationName`, `logs`, `warnings`, a process's `tags` (host
  name, IP, client version) and every other tag. An export of the same
  traffic as an OTLP file gives the same observed file.
- **A browser's HAR** (P112): the Network tab's *Save all as HAR*, or what
  Playwright's `recordHar` writes for each test (P205), the record of exactly
  the calls a front end makes into its API. Each call a script made
  (`_resourceType` `xhr` or `fetch`; where the browser does not write it, a
  JSON answer, or no answer type for a method other than `GET`) is a client
  span of the front end: method, the path's shape, `response.status` (`0`
  from a browser or `-1` from Playwright, a call blocked, cancelled or left
  unanswered, is *it failed* with no status), `time` and `startedDateTime`.
  Scripts, styles, images, fonts and pages are skipped and counted, and so is
  what Playwright marks as not the page's own call to a server: a request the
  test made through its `request` API (`_apiRequestRef`), one a service
  worker made (`_serviceWorkerRef`), and one the test answered
  (`route.fulfill`, `_wasFulfilled`) or stopped (`route.abort`,
  `_wasAborted`). Playwright's `mode: 'minimal'` and `'full'` read the same,
  and so do its `content` settings: `'omit'` keeps no body, `'embed'` keeps
  them inline, `'attach'` writes each to a file beside the HAR (`_file`), or
  into the `.zip` with it, which `--shapes` reads from there and from nowhere
  else (a name that is not a plain file name is refused). The front end is `--service`, else the one service the
  map has browser calls for; with several, the file is refused with that hint.
  The URL's origin is compared with where the front end's base URLs point -
  the values its own files give `apiBaseEnv` keys, through `apiTarget`, and
  the hosts each service is reached at (its name, `services[].hosts`, what
  the project's files say) - and dropped: a match narrows the call to the
  call site with a join into that service's route, and that join is counted
  from the call alone (a HAR has no trace context, so it is never joined to a
  back end's spans). A call to this machine or to the front end's own origin
  is matched by path among the front end's calls. A call to an origin nothing
  names is a third party, listed as `external` by its host only, never its
  path; when every call is one, the summary says no base URL matched and to
  name the API's host under `services[].hosts`.

  **A HAR holds your cookies, tokens and the body of every request.**
  flowatlas copies none of it: each entry is read for those fields by key and
  nothing else of it is ever held - never `request.headers`, `cookies`,
  `queryString`, `postData`, `response.headers`, `cookies`, `content` (only its
  `mimeType`, to tell a call from a file), `redirectURL`, `serverIPAddress`,
  `connection`, `timings`, `pages`, `creator`, `browser`, `comment`, or any
  key starting `_` but `_resourceType` and Playwright's four marks above (read
  for whether they are there, never their value); the query and fragment are cut before
  a span exists, and an error names the entry and the field, never quotes the
  file. Nothing of the file is cached or written. Delete the HAR after the
  run.

**What is kept, and nothing else.** Every reader copies only what is on one
allow-list, while it walks a span's attributes, before a span exists: service
name, span kind, HTTP method, route template, the path with every value-like
segment (any digit, or a long token) masked as `:value`, messaging
destination, `Class.method`, table or collection, rpc service and method,
HTTP status, duration, the error flag, start time, trace, span and parent
ids, and on AWS the function, trigger, workflow, step, tables, the function
invoked, the SDK operation and the service a destination is spelled for, each
a deployed name; of a browser's call, the service its origin names, or a
third party's host; and of a client or producer span, the service OpenTelemetry's
`peer.service` names - a name only: an address (a port, a dotted host, an IP)
is dropped, and a value-like name is masked as `:value`. Never read: headers, cookies, query strings, bodies, statements and
queries, `enduser.*`, span names, events and exception text, status messages,
hosts, and @nestjs/observe's `u`, `rq`, `tg` and `logs`. The file says so in a
`privacy` block: the kept list, the dropped categories as fixed text, and how
many attribute keys were seen and not read — a count, never a name. What a
reader saw and did not read as a whole is counted in the summary too:
`not read: 1 node without o, c and m, 1 entry of type image`.

A masked segment still fits a declared literal the same rule masks (P213):
`/api/:value/orders` reaches `GET /api/v1/orders`, as a parameter would, so a
versioned path is matched without the version being kept; where the same
place is also a parameter (`/api/:version/orders`), both fit and the span is
counted as could be either.

A server span is matched to an entry by method and route template (the most
literal template wins); a `Class.method` to a handler or method; a messaging
destination to a channel, and to the emits or consumes edge of the span's
service; a client span to the outbound call with that method and path; and a
server span whose parent is in another service to the join from that service
into the entry. What matches nothing is listed as seen at run time, not found
in code.

A call whose `peer.service` names a service the map has none of (P146) is
counted as `peer`, by the calling service and that name, beside whatever
else the span matched: `peer gateway payments-api (6)`. The name is the
map's when it groups with one of its services the way `doctor`'s
missing-repository groups do (separators, generic words such as `api` or
`service`, and the plural taken off), so `orders-api` is `orders` and is not
counted. Nothing is matched by `peer.service`; it is evidence that a
repository the calls go to is not in the configuration, and `doctor` counts
it as such: traffic, beside the spans of a service nobody configured (P144).

**On AWS Lambda (P107).** A span an OpenTelemetry-instrumented function, or
the AWS Distro's Lambda layer, writes lands on the node the Terraform and the
state machine readers draw for it:

| The span says | It is matched to |
|---|---|
| `faas.name`, else the function's ARN in `cloud.resource_id` (an alias or a version after it cut), else `aws.lambda.invoked_arn` | the `invoke` entry of that deployed name; with `http.route` too, the route as well |
| `aws.step_functions.state_machine.arn` or a state machine's ARN in `cloud.resource_id`, on the run's span | the `workflow` entry |
| `aws.step_functions.state.name` | the step, only when that workflow has a step of that name; and the join from the step into the function its task invokes, when that function's span is under it |
| `rpc.system=aws-api`, `rpc.service=DynamoDB`, `aws.dynamodb.table_names` (a list) | each `table`, the step's query of it, and for a write the `emits` join onto `dynamodb/<table>` when its stream is read |
| `SQS`, `SNS`, `Kinesis`, `S3` sends: `aws.sqs.queue.url`, `aws.sns.topic.arn`, `aws.kinesis.stream_name`, `aws.s3.bucket`, `messaging.destination.name` | the channel as the readers spell it (`order-placed` on an SQS span is `sqs/order-placed`) and the `emits` join from the caller |
| `EventBridge` `PutEvents` (`aws.eventbridge.bus_name`, else `default`) | the bus's one channel, or the one the caller's code puts events on; with several, none, and an ambiguity row |
| `Lambda` `Invoke` (`faas.invoked_name`), `SFN` `StartExecution` | the join from the call site into the `invoke` or `workflow` entry |
| a consumer span with `messaging.system=aws_sqs`, or `faas.trigger` `pubsub` / `datasource` with no message span | the channel, the `consumes` join onto the mapping, and the join from it into the function |

Which join a call ran is settled by where it ran: the function's code read
down from its handler, or the step it is part of, so a write onto a table
from the function and one from a workflow step are told apart. A function,
workflow, step or table the map does not have is listed as `function`,
`workflow`, `state` (named `<workflow>/?`, never by a step name the map
lacks) or `table`; an SDK call of a service nothing here reads as `cloud`, by
`<service>/<method>` only. Every ARN and URL is cut to the name inside it with
the forms the deployment readers use, before a span exists, so no account id
or region reaches the file; no request parameter (a key, an item, a message
body, a workflow's input) is ever read. See `fixtures/lambda-traces`.

**A span counts once.** It is credited to a join, an entry, a method or a
table only when exactly one fits. When several do — two routes tied for its
path, two calls from the caller's service into the entry, two outbound calls
with the same method and path, two methods of one name — none of them is
credited and the span is listed under `ambiguous` with the places it could be
(at most five named, `more` counting the rest). The summary lists them as
*could be more than one place, so counted on none*. When the far side of a
call was read, the join it confirms settles which call it was.

**Timings, statuses, errors.** Each place a span was credited to keeps a
count, a histogram of durations (log buckets about 9% wide, so a p95 is within
that of the true one), the exact max, every status seen and how many failed.
A failure is the error flag or a 5xx; a 4xx is in the status mix only, since
a 404 is often the right answer. An entry or a method is timed on the span
that matched it; a join on the caller's span when one was read (it holds the
network and the far side's queue, which is what *this step is slow* means),
the callee's otherwise, and `measuredAt` says which. A span with no end time,
or one before its start, is counted without a duration; a status that is not a
number is left out. The summary names the five entries with the highest p95,
the five failing most, and the window.

**Runs add up.** Each run loads the file, adds what it read hour by hour of
span start time, and writes it back, so two runs over two files give the same
file as one run over both. A file is known by the hash of its contents, never
by its path: reading the same export again (gzipped or not) is skipped and
said. The file keeps, per entry, the three slowest and the three latest
failing requests as trees of what each span was credited to — the only place
a trace id is written, with no span or parent id — for the graph server's
`trace_for`. A format-1 or format-2 file is carried forward: its counts become
one hour at its latest time, with no timings, and the summary says it was
upgraded.

`visualise` ships the file into the page when it is there; the page shows
*seen at run time, could be more than one place* with each candidate beside
the unmatched list, and carries `p50`, `p95`, `max`, errors, statuses and the
window for the page to draw (not drawn yet). The graph server's `get_flow` and
`who_calls` show `observed: n` with `p95` and `errorRate` beside it on the rows
it counted, and `seenAmbiguous: n` on a row that a request could have been;
`hot_paths`, `slow_steps`, `trace_for` and `undeclared_failures` answer from
it (see the [MCP guide](mcp.md)). The statuses each way in answered are set
beside the failures its code declares (P106): on the page's failure chips, in
`get_flow`, `describe_for_prompt` and *Copy as prompt*, and as `doctor` rows
(see [`flowatlas doctor`](#flowatlas-doctor)). Nothing is drawn from a trace: an edge it did not
confirm keeps the confidence it was read with, and the graph and its hash
never depend on traffic.

The file is `observedFormatVersion: 3`:

```
{
  observedFormatVersion: 3, spans,
  privacy:   { kept, dropped, droppedAttributes, bodies?, samples: { kept, perEntry: 3, spansPerSample: 200 } },
  window:    { since?, from, to },
  sources:   [{ sha256, format, spans, readAt }],
  joins:     { [joinId]:    { count, lastSeen, firstSeen, p50?, p95?, max?, statuses?, errors, errorRate, measuredAt } },
  entries:   { [entryId]:   { hits, lastSeen, firstSeen, ...the same figures } },
  symbols, channels: { [nodeId]: { hits, ... } },
  unmatched: [{ service?, kind, name, count, ... }],
  ambiguous: [{ service?, kind, name, candidates, more?, count }],
  samples:   { [entryId]: { slow: [sample], failing: [sample] } },
  shapes?:   { [entryId]: { request?, responses?: { [status]: shape }, samples, lastSeen } },
  buckets:   [{ hour, spans, joins, entries, symbols, channels, unmatched, ambiguous, shapes? }]
}
```

The top level is the window rolled up, under the names version 1 used, so a
reader of version 1 or 2 finds its fields meaning the same thing; `buckets`
hold the hours it is made of. `shapes` and `privacy.bodies` (`not read` or
`read for shape only`) are there only once a run read bodies with `--shapes`
(below); a file without them is the same version. Times are milliseconds. The page and the graph
server read versions 1, 2 and 3; a file that cannot be read makes `visualise`
say so and show nothing seen at run time, and makes `observe` refuse to write
over it unless told `--reset`.

| Flag | Meaning |
|---|---|
| `--config <path>` / `--db <path>` | which graph to match against |
| `--service <name>` | service of spans the file does not name one for; for a HAR, the front end it was saved from |
| `--since <dur>` | keep only the hours inside this window of now (`2h`, `24h`, `7d`, `2w`; whole hours, `30m` is refused) and its samples; kept in the file, so later runs keep cutting the same way. `--since all` stops cutting |
| `--reset` | start the file again instead of adding to it |
| `--no-samples` | keep no sample requests and remove the ones the file holds: then it holds no trace id at all |
| `--shapes` | read the JSON bodies a HAR or a @nestjs/observe batch carries, for their shape only, and compare them with the declared types (below) |
| `--format json` | print `observed.json` (format 3) instead of the summary |
| `--diff <a> <b>` | instead of reading traces, compare two observed files (read, never written): slower, failing more, newly seen, no longer seen, as text or with `--format json` |
| `--min-count <n>` | with `--diff`, the fewest requests both files must have seen before a time or a failure share is compared (default 20) |
| `--workflow <name>` | the state machine a Step Functions execution history is of, when the file does not name it |
| `--function <name>` | the function Lambda `REPORT` lines are of, when no log group names it |
| `--access-log-keys <map>` | the keys an API Gateway access log uses, when they are not the documented ones: `route=<k>,method=<k>,path=<k>,status=<k>,latency=<k>,time=<k>` |

Each of the last three applies only to the format that needs it: given for any
other file, it is an error (`--workflow applies to sfn-history files only;
traces/a.json is otlp`), never a flag quietly unused.

#### `observe --shapes`: what traffic carried against what the code declares

The contract check compares one side's code with the other's, and both can be
wrong the same way; a body built by hand can carry fields neither declares.
With `--shapes`, and only then, `observe` reads the bodies a file carries - a
HAR's JSON `postData.text` (or the names of its form fields) and JSON
`response.content.text` (base64-decoded when `encoding` says so), or the
file Playwright's `content: 'attach'` put either in (beside the HAR, or in its
`.zip`), a @nestjs/observe snapshot's `rq.body` (the JSON text the agent
serialised; one it cut to its size limit, `bodyTruncated`, is counted and
not parsed) - and keeps their **shape**: key names,
JSON types (`string`, `number`, `boolean`, `null`, `object`, `array`, `mixed`)
and how many bodies carried each key. Each body is parsed, walked and dropped
in one function. No value is kept: not a string, a number, an enum member, a
length or a format. Without `--shapes` no reader looks at a body at all, and
the file's `privacy.bodies` says `not read`; with it, `read for shape only`.

A key that is itself a value is not kept as a name: a key with a digit, longer
than 32 characters, with an `@` inside it, a UUID or a long hex token folds,
with every other such key of its object, into an index signature of their
merged values - the rule a path segment is masked by. An object of more than
64 keys folds wholly; deeper than 6 levels, or past 200 objects in one body,
an object is kept as `object` with nothing said of it; a body over 1 MB is
skipped and counted, as is one that is not JSON. Formats with no bodies (OTLP,
Zipkin, Jaeger, the AWS exports) are said once and read as without the flag.

The shapes go on the route each exchange reached, by status for answers,
under `shapes` in `observed.json` and in each hour's bucket, so `--since` cuts
them like the counts. A route that holds shapes from the window was reached,
even when the call that carried them fit several call sites and so was
counted on none (P148): it is never *not seen in* the window, nor is its
handler, and `dead` calls it alive, seen as many times as bodies reached it;
its hits and joins stay what the spans said. `observe` then compares each route's shapes with its
code through the contracts package and the wire rules (a `Date` declared and
a string carried is not drift): the request against the route's body type,
each 2xx answer against its declared return type, or against the type the
code calling it expects back when the route declares none readable. The
summary names the routes whose traffic differs, five at most, each with its
first paths:

```
bodies read for shape only (key names and JSON types, no value): 9 exchanges placed on a route, 1 on none (no single route fits the call)
traffic differs from the code on 3 route(s):
  billing POST /invoices  2 fields: request amount, request memo
  gateway GET /orders/:param  2 fields: 200 history, 200 owner
  gateway POST /orders/:param/invoice  2 fields: request giftNote, request status
```

`flowatlas contracts` lists them field by field, with how often each was
carried; `--listen` does not take `--shapes`.

#### `observe --listen`: a receiver on this machine

Files are the default, but the shortest loop is *run the service, click
through, look*. `flowatlas observe --listen` takes what an OpenTelemetry SDK
and the @nestjs/observe agent post, on `127.0.0.1:4318`, and fills
`.flowatlas/observed.json` as requests happen: no collector, no file exporter,
no backend.

```
$ flowatlas observe --listen
listening on http://127.0.0.1:4318: OTLP/HTTP traces at http://127.0.0.1:4318/v1/traces (JSON or protobuf, gzip), @nestjs/observe batches at http://127.0.0.1:4318/applications/telemetry; metrics and logs are dropped; nothing is forwarded. Writing .flowatlas/observed.json; Ctrl-C to stop
70 spans, 3 joins, 6 unmatched since start; dropped: 1 metric post, 1 log post
^C
stopped: 70 spans, 3 joins, 6 unmatched since start; dropped: 1 metric post, 1 log post
```

Point the service's exporter at it, unchanged:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf     # or http/json; grpc is not taken
OTEL_TRACES_EXPORTER=otlp
```

and the @nestjs/observe agent's `endpoint` option, or `OBSERVE_ENDPOINT`, at
`http://127.0.0.1:4318` (it posts its gzipped batches to
`/applications/telemetry`; its `x-api-key` and `x-api-secret` headers are
never read). What it answers is what
each sender's own server answers: `200` with an empty
`ExportTraceServiceResponse` (`{}`, or no bytes for protobuf) on
`/v1/traces`, `/v1/metrics` and `/v1/logs`, `202` with no body for a batch.
Metrics and logs are read to their end and dropped unparsed, so an SDK set to
export everything does not see errors.

Every post is read as `observe` reads a file — the same readers, the same
allow-lists — inside the request: the body is inflated, decoded and read, and
only the reduced spans outlive it. A trace's spans are held together, by trace
id, until nothing was added to it for `--trace-wait`, so a server span meets
its caller's client span that came in another service's post; the buffer
holds at most 10,000 spans and 2,000 traces, and a trace pushed out early is
matched as it is and counted (`1 trace cut short`). Every `--flush` and on
Ctrl-C, what was matched is merged into the file with the merge a file run
uses (written to a temporary file and renamed, so the page and the graph
server never read half a file), so the same traffic gives the same file
either way. Each flush adds one `sources` entry, `{ format: 'listen', spans,
readAt }`, known by a hash of the bodies first read in it; a body already
read (an exporter's retry, or a file read before) is answered and not counted
again. The graph is read at start and again when `graph.db` changes.

While it runs it holds `.flowatlas/observed.lock` (its pid inside); an
`observe <files>` run at the same time waits five seconds for it, then says a
listener is running. A lock whose process is gone is taken over.

**What it will not do.** It binds `127.0.0.1` (or `::1`, `--host ::1`); any
other address needs `--allow-remote` as well and prints a warning naming it
(`--host 0.0.0.0` alone is refused). A browser page cannot use it: a request
whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`
is `421`, so a site that rebinds its name to this machine cannot post; a
request with an `Origin` header is `403`; `OPTIONS` is `405` and no CORS
header is ever sent; `text/plain`, the type a page may post without asking,
is `415`. A body over `--max-body` is `413` and the connection is cut —
before inflating and after, so a small gzip body cannot unpack past it.
Other paths are `404`, other methods `405`, an encoding other than gzip
`415`, and a body that does not decode `400`. Of the request's headers only
`Host`, `Content-Type`, `Content-Encoding` and `Content-Length` are read, and
whether an `Origin` is there: an exporter's credentials (an `Authorization`
or API key header) are never looked at. It forwards nothing and opens no
connection. To keep a backend as well, give the service two exporters (the
SDK's multi-span-processor setup) or run a collector with two.

| Flag | Default | Meaning |
|---|---|---|
| `--listen [port]` | `4318` | take posts instead of files (files and `--listen` are exclusive) |
| `--host <addr>` | `127.0.0.1` | the address to bind; not loopback needs `--allow-remote` |
| `--allow-remote` | off | let `--host` be an address other machines can reach |
| `--flush <dur>` | `30s` | how often the file is written (`500ms`, `30s`, `5m`) |
| `--trace-wait <dur>` | `30s` | how long a trace is held for more of its spans after its last one |
| `--max-body <size>` | `8mb` | the largest body taken, before and after gzip |
| `--quiet` | off | no line per flush |
| `--service`, `--since`, `--reset`, `--no-samples` | | as for files; `--reset` starts the file again at the first flush; with `--no-samples` a trace id lives only in the buffer, for at most `--trace-wait`, and is never written |

`--workflow`, `--function`, `--access-log-keys` and `--format` name things
about files and are refused with `--listen`. To try it without a service,
`node scripts/observe-send.mjs` (in a checkout of this repository) posts
`fixtures/multi-repo/traces` to it as JSON, protobuf, gzip and
@nestjs/observe batches.

#### AWS exports, without a collector

A Lambda project often has no OpenTelemetry collector, but it has X-Ray, the
console's execution history, access logs and a `REPORT` line per invocation.
`observe` reads four exports of them (P108), each a file the AWS CLI or the
console writes; it calls no AWS API. What each says becomes the same span
fields an OTLP span of it gives (*On AWS Lambda* above), so it lands on the
same nodes, through the same allow-list: every ARN and URL is cut to the name
inside it, and a JSON string inside a file (an X-Ray `Document`, a log
`@message`) is parsed, read field by field and dropped. A file that needs a
name it does not say is refused with the flag that gives it, never counted on
a guess. Over `fixtures/lambda-traces`, the X-Ray export of the checkout gives
every entry, join, step, table and channel its OTLP trace gives; each other
export gives the entries it can see, with the same counts.

| Export | Format name | Gives |
|---|---|---|
| X-Ray traces | `xray` | entries, joins, steps, tables, channels, samples |
| Step Functions execution history | `sfn-history` | the workflow's run, its steps, a step's direct invoke of a function, samples |
| API Gateway access log | `apigw-access-log` | the route's hits, statuses and latencies; no joins, no samples |
| Lambda `REPORT` lines | `lambda-report` | each function's runs, durations and errors; no joins, no samples |

**X-Ray traces** (`xray`).

```
aws xray get-trace-summaries --start-time <t0> --end-time <t1> --query 'TraceSummaries[].Id' --output text
aws xray batch-get-traces --trace-ids <id> <id> ... > xray.json
```

One output, an array of outputs, one per line, or a bare array of segment
documents. Read, of each segment: `id`, `trace_id`, `parent_id`, `start_time`
and `end_time`, `fault` (the error; `error`, a 4xx, is not one, its status
is), `http.request.method`, the path of `http.request.url`,
`http.response.status`, `origin`, `inferred`, `resource_arn`, and of `aws`:
`operation`, `function_arn`, `function_name`, `table_name`, `resource_names`
(DynamoDB), `queue_url`, `topic_arn`, `state_machine_arn`, `bucket_name`,
`stream_name`. `name` is read as a segment's service, a state machine's step
(its direct subsegments) and an SDK subsegment's AWS service; never a remote
call's, which is its host. An `AWS::Lambda::Function` segment is the
function's run; an `AWS::StepFunctions::StateMachine` segment the workflow's,
its subsegments the steps; an `AWS::ApiGateway::Stage` segment the route,
the stage cut off the path. A function's trigger is said by what it hangs
under: a stage, a step, an invoke, or a send or a write a mapping delivered.
The `AWS::Lambda` segment above a function's own, and subsegments that name no
call (`Invocation`, `Overhead`, a team's own), are read through, their
children hung on their parent, and counted in the summary. An inferred segment
of an AWS service is the callee's side of its call; one of a remote host is
not read. Never read: `annotations`, `metadata`, `sql`, `user`, `cause`,
`aws.request_id`, `aws.account_id`, `aws.region`, `aws.xray`,
`http.request.client_ip`, `user_agent`, `x_forwarded_for`.

**A Step Functions execution history** (`sfn-history`).

```
aws stepfunctions get-execution-history --execution-arn <arn> > run.history.json
```

The machine is named by `stateMachineArn` or `executionArn` when the output of
`aws stepfunctions describe-execution --execution-arn <arn>` is merged into
the file (`jq -s '.[0] * .[1]' describe.json history.json`), by the version or
alias ARN an `ExecutionStarted` event carries, else by `--workflow <name>`;
with none, the file is refused: `run.history.json names no state machine
(merge describe-execution's stateMachineArn into it); name it with --workflow
<name>`. The run, from `ExecutionStarted` to `ExecutionSucceeded` / `Failed` /
`TimedOut` / `Aborted`, is one span on the `workflow` entry, its trace id the
execution's name (never its ARN). Each `*StateEntered` / `*StateExited` pair,
by `name` and the chain of `previousEventId`s (so a Map state's iterations are
one span each), is a step under the step around it; a `TaskFailed`,
`LambdaFunctionFailed`, `LambdaFunctionTimedOut` or `ExecutionFailed` inside
it fails it. `LambdaFunctionScheduled.resource` is a call that invokes the
function; `TaskScheduled` is the service and operation of its `resourceType`
and `resource` only (`lambda` / `invoke` is `Lambda/Invoke`), and names no
target, since its `parameters` are not read. Never read: every `input`,
`output`, `inputDetails`, `outputDetails`, `parameters`, `cause` and `error`
text, `roleArn`, `taskToken`.

**API Gateway access logs** (`apigw-access-log`), in the JSON format the API
Gateway docs give as the example, such as
`{ "requestId":"$context.requestId", "ip":"$context.identity.sourceIp",
"requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod",
"routeKey":"$context.routeKey", "status":"$context.status",
"responseLatency":"$context.responseLatency" }`:

```
aws logs filter-log-events --log-group-name <access-log-group> --start-time <t0> > access.json
```

or JSON lines, or a Logs Insights result downloaded as JSON or CSV. Read,
matched without regard to case: `routeKey` (`POST /checkout`; `ANY` takes the
request's method), else `httpMethod` + `resourcePath` (a REST API's template);
`$default` and a missing template fall back to the path of `path`; `status`;
`responseLatency`, `latency`, `integrationLatency`, the first there;
`requestTimeEpoch` or `requestTime`; `integrationStatus` of 500 or more is an
error. A team that named its keys otherwise says them with
`--access-log-keys route=rk,status=code,latency=took,time=when`. One span a
line, with no parent: entries only, never a join, and no sample. Never read:
`ip`, `sourceIp`, `userAgent`, `caller`, `user`, `identity.*`, `authorizer.*`,
`requestId`, `extendedRequestId`, `domainName`, or any key not named above.

**Lambda `REPORT` lines** (`lambda-report`), from a Logs Insights query over the
functions' log groups,

```
filter @type = "REPORT" | fields @timestamp, @message, @log, @logStream, @duration
```

exported from the console as JSON or CSV (or `aws logs get-query-results`),
or plain lines starting `REPORT RequestId:` (as `aws logs tail` prints them,
with `--function`). The function is named by the record's log group
(`/aws/lambda/<name>`, `@log` being `<account>:<group>`; the account is not
read) or its stream in a log group of the team's own, each line by its own,
else by `--function <name>`; lines none of them names refuse the file. Each
line is one run of the function: `Duration` (or `@duration`), `@timestamp`,
and an error when the line says `Status: error` or `Status: timeout`. One span
a line, with no parent, and no sample. Never read: `RequestId`, `Billed
Duration`, `Memory Size`, `Max Memory Used`, `Init Duration`, the X-Ray
`TraceId` and `SegmentId` on the line, and every line that is not a `REPORT`
line (counted: `not read: 2 lines not starting REPORT`).

---

## Checking

### `flowatlas doctor`

What could not be read, what the annotations get wrong, what has drifted, and
whether any of it has grown since the baseline, and which architecture rules
the graph breaks. Six sections over one built graph; it reads no repository's source, so two runs over one graph say the same
thing. It looks at a repository only to say whether its dependencies are
installed, and what a service with no way in looks like.

A `desync` row is a call aimed somewhere that did not land: its verb and path,
and the service or setting it was aimed at. A request for a procedure has no
verb or path of its own, so its row names the procedure and its link's protocol
instead (`rpc orders.store`, P256), with the setting its link is rooted at, and
carries `procedure` and `protocol` in `doctor.json`.

| Flag | Default | Does |
|---|---|---|
| `--section <name>` | all six | `unresolved`, `markers`, `desync`, `contracts`, `rules`, `baseline`; repeatable |
| `--service <name>` | every one | narrow every section to one repository |
| `--reason <code>` | every one | only the places of this reason, at every level it is at; repeatable, or a comma list. The sections default to `unresolved` and `desync`, the two made of rows that carry a reason. A reason neither the catalogue nor any row knows stops with exit 2 and the nearest names; `--accept` refuses it. With `--unresolved`, narrows the breakdown the same way |
| `--strict` | off | exit 1 on a broken annotation, a contract error, a rule violation at `error` the baseline does not hold, or growth past the baseline |
| `--strict-runtime` | off | exit 1 on a failure traffic answered that the code does not declare, or one it declares that no request answered (with an observed file) |
| `--accept` | off | write today's numbers as the baseline |
| `--baseline <path>` | `<config dir>/flowatlas.baseline.json` | where the accepted numbers live |
| `--no-baseline` | off | skip the growth check, so `--strict` asks only about annotations and contracts |
| `--no-contracts` | off | do not run the contract check |
| `--no-rules` | off | do not check the architecture rules |
| `--max-nodes <n>` | 6 per reason, 150 per section | most places named under one reason, and rows in each other section; what is printed (text, `github`, `sarif`, and `--format json` with its `truncated` counts) is cut, and the written `doctor.json` is always complete: every row of every reason and section, with no `truncated` field |
| `--format <name>` | `text` | `text`, `json`, `github`, `sarif` ([SARIF](#--format-sarif-findings-for-code-scanning); every place up to 5,000 unless `--max-nodes` says, a cut naming `doctor.json`) |
| `--out <dir>` | configured output | where `doctor.json` goes |
| `--unresolved` | off | instead of the report, what the reader could not follow, grouped by cause and by package |
| `--missing` | off | instead of the report, only the repositories probably missing from the project, each with every place that points at it (below); `--json` as data |
| `--scan <dir>` | none | also look for a missing repository in this directory, one level down; repeatable |
| `--top <n>` | 10, or 5 with `--missing` | with `--unresolved`: most causes, and packages per cause, to list; with `--missing`: most repositories |
| `--samples <n>` | 3 | with `--unresolved`: places listed per package under a cause |
| `--cause <code>` | every one | with `--unresolved`: only this cause, e.g. `module-not-installed` |
| `--package <name>` | every one | with `--unresolved`: only what points into this package or module |
| `--json` | off | shorthand for `--format json` |
| `--output <file>` | stdout | with `--format sarif`: write the log here and print one line about it |
| `--sarif-root <dir>` | the configuration's directory | with `--format sarif`: paths relative to this checkout ([SARIF](#--format-sarif-findings-for-code-scanning)) |
| `--sarif-level <level>` | `note` | with `--format sarif`: leave out results below `error`, `warning` or `note` |

**`--unresolved`: why the reader stopped.** The report lists rows by reason,
and a reason says what was not read - a call, a type, an injection. A row about
a step that could not be followed also records the cause the code states for it,
and the package it points into, and `--unresolved` groups every place by those:
a package that is not installed (`module-not-installed:<package>`), an import of
a path or alias that resolves to no file (`import-unresolved`), a module that
resolves and does not export the name (`re-export-missing`), a value typed `any`
by the project, by a package or by the language (`any-typed`, `language-any`),
a parameter nobody typed (`untyped-parameter`, `callback-param`), a method
picked by key (`dynamic-member`), a receiver typed by an interface or a union
(`interface-type`, `union-receiver`), a field given its function from elsewhere
(`function-field`), a value provided through a token (`untyped-di-token`), and a
receiver of a data layer named by spelling only (`data-layer-unnamed`). A row
with no finer cause counts under its own reason, so the total is always the
report's `sites`. Most places first, each cause with what to do and a few
`file:line` to open, then the packages on their own: "install this one" is a
question about a package. Accepted gaps are left out and counted apart, as in
the report. `--json` prints the same as data (`cantFollowFormatVersion: 1`;
`reasons` is the `--reason` list it was narrowed to, or `null`). With a
[question log](#the-question-log) beside the graph, each cause carries `asked`,
how many logged questions ran into its rows, and the causes asked about most
come first: the gaps people run into are the ones worth fixing first.

**The repository that is probably missing.** The commonest reason for a request
no service claims, a package nobody installed and a channel with one end is one
repository nobody added to the configuration. Each of those is read from the
graph as evidence, with the name it points at:

| Evidence | From | Name |
|---|---|---|
| a setting | an `unknown-base-url-env` row no service claims (`PAYMENTS_URL`, `paymentsApi`) | its words less `_URL`, `_HOST`, `_BASE`, `Api`, `Service`: `payments` |
| a host | a third party written in the call, or a value of such a setting, whose host is the project's own: no dot, `localhost:<port>`, a private address, `*.internal`, `*.local`, `*.svc`, `*.cluster.local`, or a name under a domain a service's `hosts` uses | its first label, a cluster's service name, or the host itself for `localhost:<port>` |
| a package | `module-not-installed:<package>`, under the scope of a configured service's own `package.json` name, that no read repository is | without its scope and its `-client`, `-sdk`, `-types` |
| a channel | `channels.noConsumers` / `noProducers` | its first segment (`payment.captured` → `payment`), its transport's word left off (`sqs/…`); an EventBridge event by its `source`'s last dotted word (`eventbridge/default/com.acme.payments/…` → `payments`), by its bus only when the source names nobody and the bus is not `default`, and by neither for the platform's `aws.*` sources and a partner's bus |
| a subscription | a `stream-no-writer` row (a stream a function reads that nothing configured writes to), or a `subscription-matches-nothing` row (a rule taking events by a pattern nothing published matches) | the stream as a channel is named; each `source` the pattern names, by its last dotted word (`acme.payments` → `payments`; `aws.*` sources are the platform's and name none) |
| a deployment | `invoke-target-not-found`, `route-root-not-found`, `function-handler-not-found` | the deployed name's service part, its stage word and its own last word left off |
| traffic | with an observed file beside the database: a `seen-not-in-code` blind spot (what `observe` matched to nothing) whose `service.name` no configured service has; or a `peer` blind spot, a call whose `peer.service` names a service the map lacks (P146), from any service | the service's name; for a `peer` row, each name the calls went to (a masked `:value` is none) |

A subscription is one kind for both rows, and weak alone like a channel with
one end: a stream or a rule that nothing here writes to is as often fed by
another account, a partner or the platform as by a repository nobody added. It
counts once another kind agrees or a directory fits. A declared stream that is
read and never written is said only as a subscription, not again as a channel
with one end (one fact, one kind), and an accepted row is no evidence. Both
rows stay findings; their check's *How to close it* now opens with the
`flowatlas link` line.

Traffic is one kind among the others. Alone it is weak: a proxy, a collector or
a browser writes spans under a name of its own, so it is said in the report's
head only when another kind agrees or a directory fits. The places it adds are
its blind-spot groups, one per kind, each with what it reached and the window
it was seen in. A configured service's blind spots are never evidence (a reader
missed something there; no repository is missing), and without an observed file
the groups are what the code alone says. Hosts stay unread in traffic (`observe`
keeps no host), so a call to a host nobody answers is evidence from the code
only, unless its instrumentation named the far side in `peer.service`: then
each caller is a place of that name, `gateway: called payments-api, 6 spans in
1h (peer.service)`, and the spans a service wrote itself and the calls that
named it are one kind of evidence, said in one line.

`target-route-not-found` is not evidence: its service is configured, and what is
missing is a route. Names are put together once the separators, the generic
words and a plural are taken off (`payments`, `payment`, `payments-api` are one),
ranked by how many kinds of evidence agree and then by places, and a name that
is a configured service's - its name, an alias, a host, its package - is left
out: that is a join to fix, not a repository to add. Then the directories beside
the configured repositories (their parents, one level down) and in each `--scan`
directory are matched by their `package.json` `name` (with or without scope),
their directory name, a compose service built from them in the files beside the
configuration, and the hosts their own setting files say they are reached at.
Only a candidate's manifest and the setting files at its top are read - never
its source - and a directory already configured is never offered.

The report opens its unresolved section with the likeliest few, where the
evidence is worth saying on its own (an address or a deployment nobody answers,
two kinds that agree, or a directory that fits):

```
Probably missing: a repository for "payments" — 4 kinds of evidence, 6 places
  PAYMENTS_URL is used by gateway (2 requests) and no service claims it
  @acme/payments-client is imported by orders and is not installed
  channel payment.requested is published by orders and nobody here consumes it
  events from acme.payments* are taken by jobs (1 rule) and nothing here publishes one
  stream kinesis/payments is read by jobs and nothing here writes to it
  ./payments-api looks like it (package @acme/payments-api, its directory name, a compose service built from it): flowatlas link ./payments-api
```

or "nothing next to the configured repositories looks like it; if it exists
elsewhere, `flowatlas link <path>`". The command is written for the directory
`doctor` runs in. `--missing` prints every group, with every place under each
line, or "nothing points at a repository that is not here". With traffic beside
it, the same group gains a line and its places:

```
  traffic came from payments, which no configured service is: 2 methods and 2 routes, 8 spans in 1h
    payments: 2 methods, 4 spans in 1h: ChargesController.charge, ChargesController.refund
    payments: 2 routes, 4 spans in 1h: POST /charges, POST /refunds
```

`doctor.json` holds
them all under `unresolved.missingRepos: [{ token, score, places, kinds, weak,
signals: [{ kind, name, says, places: [{ service, file, line, gapId, seen? }] }],
candidates: [{ path, name, matchedBy }] }]` (`path` relative to the
configuration; `weak` for a lone package, channel, subscription or traffic with nothing on disk);
`--format github` adds one `::notice` per group at the configuration file. A
guess, said as one: it decides no exit code, draws no edge and changes no
configuration. `flowatlas link --suggested` is the one command that acts on it.

**Every gap says how to close it.** The check a gap id names - on the page's row
menu (*Copy as prompt*, and *Copy for agent*, the same text as a task: make the
first change that fits, then `flowatlas build` and `flowatlas doctor --reason
<reason>`), and from `describe_for_prompt` - ends with *How to close it*: one
line per way that applies to its reason, from one table (`REMEDIES` in
`@flowatlas/core`): link the repository that answers it (naming the one probably
missing, when the gap is its evidence), name the setting under `baseUrlEnv` or
the host under `hosts`, an alias, `apiBaseEnv` and `apiTarget`, a pattern
(`flowatlas patterns suggest --cause <reason>`), a shape file (`shapes
--suggest`), the annotation meant for it (`@CallsService`, `@flowatlas-calls`,
`@Emits` / `@Consumes`, `@FlowEntry`), or the advice on its places; and last,
the `flowatlas accept` line that takes it. A service's blind spots of traffic
(`gap:<service>||seen-not-in-code`) are one check too: linking the repository
(by name when the service is one nobody configured), else finding what it
reached and describing it so a build draws it. On the page, the *Seen at run
time, not found in code* sheet has *Copy as prompt* and *Copy for agent* for
each service's.

**What stands in for a package nobody installed.** A clone with nothing
installed still has, one directory over, the source of the internal packages it
imports. Where a service imports a package that does not resolve, and a
configured repository - or a workspace member of one, or a directory directly
under the configuration - has a `package.json` whose `name` is that package, the
import is read from that source: its `exports`, `types`, `typings` or `main`, the
same paths under `src/` where they name a build nobody ran, then `src/index.ts`
and `index.ts`, with the package's own tsconfig `paths`. It is read for its types
alone, at the path an install would have, so nothing of the package becomes a
node of the service that imports it, and what the checker cannot resolve inside
the package is said where the package is read as a repository of its own, not
again in every service that imports it. Failing that, a shape file the project
lists under `shapes` declares the package (`declare module '<package>' { ... }`),
and failing that a reader's built-in shape. The order is fixed: installed, then
source, then shape file, then built-in shape. A call drawn through types one of
these supplied is `heuristic`, with `because: ["package-from-repo"]` or
`["shape-file"]` and `typedBy: <package>`, since what is read may not be the
version that runs. Rows say what happened: `package-from-repo` (which directory
answered; a note: nothing was missed), `package-version-differs` (a note: the
importing manifest asks for another version), `package-source-ambiguous` (two
directories carry the name, so neither is read), `shape-file-unread` (a listed
file not there, not parsed, or declaring no module) and `shape-file-unmatched`
(a note: a shape something stronger answered, or one a service's own list
names and it never imports). The three notes are at level `info`. `flowatlas shapes --suggest` says which packages
are still worth a shape file.

**Rules.** With `rules[]` in the configuration, the `rules` section lists each
violation nothing excused (`flowatlas accept rule:<name>`), marked `new` when the
baseline does not hold its key, with where it crosses and the rule's note, and
each rule a side of which names nothing (`rule-matches-nothing`). `--strict`
fails on a new one at `error` - a guessed one only with
`rulesSettings.failOnHeuristic` - and `--accept` writes every key to the
baseline's `rules` map (`baselineFormatVersion` 2; a version-1 baseline is read
as one that accepted no violation). The summary line gains `rules: errors=N
new=M`; `--format github` annotates each violation at the crossing hop, under
the directory the configuration gives its repository. A rule that fails its
schema stops the run with exit 2, naming it (`rule-invalid`). See
[`flowatlas rules`](#flowatlas-rules).

**Accepted gaps.** A gap accepted with `flowatlas accept` is left out of every
count, the text says how many accepted gaps were left out, and `doctor.json`
says the same under `unresolved.accepted`. A gap is matched the same way here,
under `--unresolved`, on the page and in the graph server: demoted first where
an annotation answers it, and on the route it is about even when the row was
read back from the database without its symbol. An `accepted.json` that cannot
be read is a warning line here and `unresolved.accepted.problem` (`path`,
`kind`: `unparseable`, `invalid`, `newer-version` or `unknown-version`,
`detail`) in the file, and nothing is left out; see `accept` below.

`--strict` on a project with no baseline yet exits 2, not 1: there is nothing to
compare against, which is a different answer from "something got worse". Write
one with `--accept`, or ask without it using `--no-baseline`.

Three graphs are refused outright, with exit 2 and without `--strict`: one that
holds no node at all, one whose build recorded that a repository could not be
read, and one a service was read into that contributed nothing to it. In all
three the questions below were asked of a project the tool did not read, and
every one of them answers "nothing wrong" — which is true of the graph and false
of the project. 2 rather than 1 because the check could not be run, which is what
2 has always meant here; without `--strict` because a run without the flag still
answers a question, and "healthy" is not an answer anybody asked of an unread
graph. `--accept` refuses such a run for the same reason.

A fourth is refused the same way: a service most of whose ways in have no
handler that was read — the second of the two numbers `build` prints under
`ways in`, compared service by service. Each of those is a
`route-handler-unread` row, and a few of them are an ordinary, reportable limit:
a handler a helper builds that the reader cannot follow. They stay rows, a
baseline may accept them, and `doctor` prints the two numbers above them so the
size of the gap is in front of whoever reads it. Past half, what changes is not
how much is missing but what the check can see. The growth check sees a change
only when it adds a row, and a change inside a body nobody read never does — so
for that service the gate is blind rather than lax, and a baseline accepted over
it would be accepting the blindness. Decided per service, so a service read end
to end cannot carry a hollow one past the check by outnumbering it; `--service`
narrows the question the way it narrows every other.

**A server with no way in at all is said first.** A service a server reader read
— it holds code — with no route, handler, subscriber or screen in the graph is
one nothing reaches, so no flow starts there. That is usually a stack nothing
reads under a type set by hand, and it is the first line of the report and the
first sentence of the verdict, with what the repository looks like: a
deployment written for a tool nothing reads (SST, Architect), a framework
nothing reads, a framework that *is* read under another type, or a library:

```
api: no way in was found — its functions are declared for the Serverless Framework, which nothing here reads yet. Its code was read and nothing in this graph reaches it, so no flow starts there; its dependencies are not installed either, and installing them would not give it one.
```

It comes before anything about dependencies, and such a service is not named in
the sentence about them, because installing them would not give it a way in.
It decides no exit code: its bodies were read, so a change inside one still adds
a row the growth check can see, and a library typed as a server is a
configuration somebody may mean. `doctor.json` carries the same list under
`unresolved.withoutWaysIn`, and `--format github` makes each a `::warning` on the
line of `flowatlas.config.json` that names the service. A service declared by a
document is never named: none of its code was read, and a document that declares
no way in describes a service nothing here enters.

**Failures seen at run time (P106).** With an observed file beside the
database (`flowatlas observe`), doctor sets the statuses each way in answered
beside the failures its code declares, and adds two kinds of row, both at
`info`: `failure-seen-undeclared` (a finding), one per way in and status from
400 up that no failure declares, at the handler, saying how many of its
requests answered it over which window, with `expected: <why>` where the
framework answers it anyway; and `failure-declared-unseen` (a note), one per
declared failure no request answered in the window, at the throw, said only of
a way in hit at least 20 times. They are asked at doctor time and never stored
in the graph; being `info`, they move neither the exit code nor the baseline.
Traffic differs per environment and per week, and a build should not fail
because nobody hit a 409 on Sunday; `--strict-runtime` is there for a team that
wants it, and exits 1 on any of these rows but an expected status. `flowatlas
accept` takes one like any other row.

**What traffic reached and no reader drew (P110).** Beside the same file,
every span `observe` matched to nothing becomes a blind spot: one
`seen-not-in-code` row per service and kind (`http`, `client`, `messaging`,
`code`, `db`, `rpc`, `function`, `workflow`, `state`, `table`, `cloud`, `join`),
not per span, at `info`, with no file, saying how many places and spans over
which window and the names the trace kept (`traffic in billing reached 1 route
no reader drew, 1 span in 2h: GET /healthz (1)`). A route registered at run
time, a service not in the configuration, or a reader gap; nothing is drawn
from one. It is a gap, so `doctor --unresolved` lists the same rows under the
cause `seen-not-in-code`, each group with the call that looks for it in the map
(`find_symbol` for a method, `list_entries` for a route, `search` for the rest):

```
  seen-not-in-code: 6 places  3 services
    billing http: 1 span, last 2025-10-16T07:33:33.000Z: GET /healthz (1)
      next: list_entries({service: "billing"})
```

`join` is a send, an invoke or a start the map has the target of, from code the
map has, along a join it does not draw (`invoke print-label`).

**Best guesses confirmed by traffic (P110).** A `heuristic` join the window
went through at least once is counted apart from the best guesses, on its own
line (`1 of 4 best guesses confirmed by traffic in 2h`, narrowed by `--service`
to the guesses that service's code makes), and the row that explains the guess
(`base-url-from-name`, `base-url-from-files`, `route-mount-assumed-empty`,
`route-api-guessed`, `workflow-named-by-file`, `environment-from-files`, at the
call the join leaves from) is left out while traffic confirms it; `doctor.json`
says the counts under `traffic` (`{ window, bestGuesses, confirmed, withdrawn
}`). The edge keeps its confidence: the graph on disk never depends on traffic,
and a run without the file gives the static answer again.

The exit code is decided by the first of these that applies: a graph that cannot
be reported on, a baseline that cannot be read, or `--strict` with no baseline
(2); `--strict` and a check that found something, or `--strict-runtime` and a
failure row from traffic (1); otherwise 0.

Every unresolved row is read at one of three levels, and only the first two say
the graph is missing something:

| Level | What it means | Counted in the total |
|---|---|---|
| `action` | a setting, an annotation or a registration would close it | yes, and `--strict` compares it |
| `info` | an edge is there and static reading cannot see it | no; reported beside the total |
| `nothing` | no edge exists to draw — a template binding that assigns to a field has no method behind it | no; reported on its own line |

Level is how much a row matters; its kind is what it is about, and the two are
independent. Only a gap is counted as missed:

| Kind | What it is | Counted as |
|---|---|---|
| gap | the reader could not follow something (`call-dynamic-receiver`, `type-unresolved`, `unknown-base-url-env`) | `missed`, at `action` or `info`; `nothing` at `nothing` |
| note | how a join or a reading was made, with nothing missed (`base-url-from-files`, `package-from-repo`, `route-checked-in-body`) | `notes` |
| finding | something about the code (`query-in-loop`, `route-unguarded`, `route-shadowed`) | `findings`, and on a line of its own |

The heading says the build line's figures after the one `--strict` compares,
and findings get their own line naming what each is:

```
unresolved: 26 to act on · missed: 28 · notes: 0 · findings: 3
  5 missed places static reading cannot see, folded into 5 rows
  3 findings: 3 routes with no guard
```

A group of notes or findings is marked `(note)` or `(finding)` instead of
`(info)`, and `doctor.json` carries `unresolved.notes`, `unresolved.findings`
and a `kind` on every group. `unresolved.info` and `unresolved.nothing` count
gap rows only. The file is `doctorFormatVersion: 2`: version 2 gave a row the
level `nothing` and `unresolved` a count of the places at it, and took those
out of `rows` and `sites`. The baseline is untouched by kinds: its `total` and keys still
count every actionable row, findings included (`route-unguarded` where a guard is
expected), so a baseline accepted before kinds existed gives the same verdict
after. `build` says the same thing in its last line: what was missed, the notes,
the findings, then the places where nothing joins, never added together.

A row an annotation has already answered is `info`, not `action`. An address
built at run time that `@CallsService` or `@flowatlas-calls` already names is a
record of what could not be read rather than work left to do, and counting it
among the things to act on left a row in the baseline that nothing anybody
writes could ever clear. Acting on every `action` row a run reports takes the
number to zero.

What counts as answered is the shape the graph takes once the annotation
worked, and the shapes differ. `@CallsService` draws one edge out of the method
it is written on. `@Emits` draws two — the method reaches a producer, and the
producer reaches the channel. `@flowatlas-calls` repairs nothing: it adds a
second request beside the one that could not be read, so a browser row is
answered only where the annotations on that method are at least as many as its
unreadable requests. Two unreadable requests and one annotation keep both rows
and say why, because silencing both would hide a real gap behind an annotation
that was never about it. An annotation that reached no route answers nothing at
all.

A group of rows is headed by a sentence true of every member of it: the
members' own where they all say one thing, and otherwise the kind's, written
once. A member's own sentence sits under that member, marked `↳`. Groups are
keyed by reason *and* level, so a group's level is every member's rather than
its loudest member's.

A row is keyed in the baseline by what it names: the node it is recorded
against where it is about one, and the source text otherwise. It is shown in
words a reader finds at its place: where it names a node, by its message -
`OrdersService.tally -> this.config.get('SWEEP_CHANNEL')`, not
`producer:orders#src/orders/orders.service.ts:71:5` - and the id is in
`doctor.json` and in the key. A key is
service, file, that name and the reason; it carries no line of its own, and only
the total decides `--strict`, so a key that moves is named under `new` and
`gone` and fails nothing. A row about a publish or a start whose name could not
be read names the producer drawn for the call, whose id is its place in the file;
a baseline accepted before that release lists those rows under the
`method -> expression` they were named by, and `--accept` writes them again.

Where a repository was read without its dependencies, the report opens with the
one sentence that says so, described under [`build`](#flowatlas-build-dir),
rather than leaving the reader to infer it from a pile of `type-unresolved` rows.

#### The reasons a row can carry

Every row names what could not be read, where, and why. The reason is the word
to search for, and the word `doctor.ignoreReasons` takes, so it is configuration
surface: a renamed reason keeps its old spelling working there. `document-age`
was `openapi-document-age`, and both are recognised. `pnpm invariants` fails if
any reader writes a reason `doctor` does not know. By what they are about:

| About | Reasons |
|---|---|
| A graph or a service that could not be read | `service-read-nothing`, `file-not-parsed`, `duplicate-node-id`, `test-directory-skipped` (info) |
| A package that is not installed, read in its place | `package-from-repo` (nothing), `package-version-differs` (info), `package-source-ambiguous`, `shape-file-unread`, `shape-file-unmatched` (nothing) |
| The project's own extraction patterns | `pattern-file-unread`, `pattern-not-expressible` (a rule refused, the part named), `pattern-ambiguous` (two rules on one call, neither read), `pattern-shadowed` (info: a written description reads the call), `pattern-unmatched` (info: a rule nothing matches) |
| Types | `type-unresolved`, `type-generic-uninstantiated`, `type-depth-exceeded`, `di-type-unresolved`, `decorator-arg-dynamic` |
| Injection and calls | `di-token-unknown`, `di-token-ambiguous`, `inject-token-unresolved`, `call-dynamic-receiver`, `call-module-ref`, `call-through-token`, `global-wrapper-dynamic` |
| NestJS applications | `bootstrap-not-found`, `application-root-unread`, `module-controllers-unread`, `module-providers-unread`, `module-import-dynamic`, `module-import-not-installed`, `middleware-route-dynamic`, `fails-filter-unread`, `fails-interceptor-unread` |
| Routes and their addresses | `route-path-dynamic`, `route-mount-unread`, `route-registry-unread`, `route-file-not-served`, `route-claimed-twice`, `route-module-not-found`, `route-verb-unread`, `route-handler-unread`, `route-handler-anonymous`, `server-action-unread`, `middleware-matcher-unread` |
| A described framework that matched nothing | `entry-http-description-inactive`, `entry-http-types-unmatched`, `entry-http-routes-unmatched`, `entry-http-routes-unplaced`, `entry-procedures-description-inactive` |
| Procedures | `procedure-router-unread`, `procedure-key-dynamic`, `procedure-branch-unread`, `procedure-trees-unmatched`, `procedure-members-unmatched`, `procedure-path-dynamic`, `procedure-not-found`, `procedure-ambiguous`, `procedure-call-mismatch`, `procedure-link-dynamic`, `procedure-link-socket` (info), `procedure-link-unserved`, `procedure-prefix-unread`, `procedure-contract-unread` |
| Requests between services and from a browser | `dynamic-http-url`, `unknown-base-url-env`, `service-binding-unknown`, `target-route-not-found`, `ambiguous-route`, `ambiguous-route-application`, `ambiguous-route-api`, `route-api-guessed`, `base-url-from-files`, `base-url-from-name`, `ambiguous-route-target`, `route-wildcard-only`, `route-mount-assumed-empty`, `api-path-dynamic`, `api-method-dynamic`, `api-base-unknown`, `api-base-override-unread`, `api-client-unread`, `api-client-base-unread` |
| The gate in front of a route | `route-unguarded`, `route-guard-skipped`, `route-checked-in-body` (info), `route-public-declared` (info), `marker-reason-missing` (info), `route-shadowed` |
| What a framework's build would have written (P240) | `aliases-from-convention` (info), `aliases-from-config` (info), `implicit-imports-from-convention` (info), `implicit-import-ambiguous`, `framework-layer-unread`, `framework-setting-dynamic` |
| The layers a framework builds an application from (P243) | `framework-layer-read` (info), `framework-layer-overridden` (info), `implicit-import-overridden` (info), `framework-layer-alias` |
| What a framework still decides when it builds (P251) | `framework-module-skipped` (info, P255), `framework-module-read` (info), `framework-module-installed` (info), `framework-environment-differs` (info), `framework-module-unread` |
| Components, layouts and route middleware by name (P255) | `component-unresolved` (info), `layout-unresolved`, `route-middleware-unresolved` |
| Screens and templates | `route-config-unread`, `route-loader-unread`, `route-link-dynamic`, `route-screen-unread`, `route-target-unresolved`, `handler-not-found`, `handler-not-a-method`, `template-not-found`, `template-not-parsed` |
| The data layer | `unknown-db-package`, `db-receiver-name-only`, `db-layer-unread`, `db-handover-unstated`, `db-package-unread`, `db-call-at-module-level`, `dynamic-table-name`, `sql-parse-failed`, `unknown-db-operation`, `dynamic-cache-key`, `query-in-loop` (a query, request or publish run once per item of a loop) |
| Channels | `channel-dynamic`, `channel-const-unresolved`, `channel-from-config`, `channel-from-environment`, `consumer-handler-unresolved`, `payload-type-unknown` |
| Starting a workflow or a function by its deployed name | `start-from-environment`, `start-name-unread`, `starter-undescribed` |
| Settings | `dynamic-config-key` |
| Bots and handler tables | `bot-handlers-not-found`, `dynamic-bot-trigger`, `entry-registry-unconfigured`, `registry-key-dynamic`, `registry-handler-anonymous`, `orphan-scene-decorator`, `orphan-update-decorator`, `wizard-step-conflict` |
| Annotations | `marker-route-not-found`, `marker-service-unknown`, `marker-unknown-arg`, `marker-arg-not-a-name`, `marker-names-nothing` |
| Declared services | `document-age` |
| Functions and routes declared in Terraform | `function-name-unread`, `function-name-disputed`, `function-repeated-unread`, `function-handler-unread`, `function-handler-not-found`, `function-handler-ambiguous`, `function-source-unread`, `function-runtime-unread` (info), `function-image-unread` (info), `route-path-unread`, `route-target-unread`, `route-base-path-unread`, `api-body-unread`, `deployment-unread` (info) |
| Terraform files and modules | `infra-file-unparsed`, `infra-module-missing`, `infra-module-undescribed` (info unless its inputs name a handler, a function or a route), `infra-module-description-invalid` |
| Joining a deployment across repositories | `route-root-not-found`, `route-root-ambiguous`, `invoke-target-not-found`, `invoke-target-ambiguous` |
| Workflows written as state machines | `workflow-definition-unreadable`, `workflow-definition-invalid`, `workflow-definition-not-loaded`, `workflow-name-unread`, `workflow-named-by-file` (info), `workflow-name-duplicate`, `workflow-target-dynamic` (info), `workflow-template-unbound`, `workflow-target-unreadable`, `reference-not-found`, `reference-ambiguous` |
| Subscribers declared in Terraform | `subscription-source-unread`, `subscription-target-unread` (info for a target of a kind nothing follows), `subscription-forward-unread` (info), `event-pattern-unread`, `subscription-matches-nothing` (info), `bucket-notification-unread`, `stream-filter-not-matched` (info), `stream-no-writer` (info), `invoker-not-read` (info), `iot-action-not-read` (info) |
| Writes to a bucket | `s3-write-matches-nothing` (info): a write none of the bucket's notifications takes |
| Values a deployment gives the code | `environment-not-set`, `environment-value-unread`, `environment-from-files` |
| Architecture rules (`flowatlas rules`, the `rules` section) | `rule-matches-nothing` (a side of a rule names nothing; never a pass), `rule-invalid` (a rule fails its schema; the configuration is refused), `rule-over-partial-read` (a note: the rule names a service read in part) |

Three of these are worth knowing before they are met, because each is the
tool declining to guess:

- **`route-mount-unread`** is a route whose own path was read and whose
  application is mounted somewhere this could not read. `route-path-dynamic`
  means only that the route's own path is computed. A configuration that silenced
  the first under the second's name shows it again, on purpose: they are
  different facts.
- **`ambiguous-route-application`** is two applications in one service serving
  the same address. Which one a request from outside reaches is decided by how
  they are deployed, so both are named and neither is chosen. A request written
  *inside* one of them asks its own application, and is joined there.
- **`route-mount-assumed-empty`** is the one join made on an assumption, and it
  says so. A route whose address begins with a part read from settings is never
  joined, because a hole may stand for anything — unless every environment file
  the service commits leaves those settings empty. Then the part is taken as
  empty, the join is drawn at `heuristic` with `mountAssumedEmpty` on the edge,
  and this row, at `info`, names the settings. One committed file that sets them
  is enough to refuse it, and so is a service that commits no environment file at
  all (`fixtures/nest-mount-empty`, `fixtures/nest-mount-set`,
  `fixtures/nest-context-path`).

### `flowatlas rules`

Checks the architecture rules the configuration writes down - who may call,
write, publish to or consume what, by service, tag, table and channel - over
the joined graph, and says which edges break them. A rule is about the edges
between repositories that a single repository's import graph never holds: a
browser requesting a route of another repository, a service writing a table
another owns, a handler consuming a channel. Nothing is read from source; a
violation is only drawn along an edge the graph holds.

| Flag | Default | Does |
|---|---|---|
| `--format <name>` | `text` | `text`, `json`, `markdown`, `github` (an annotation per violation at the crossing hop) or `sarif` ([SARIF](#--format-sarif-findings-for-code-scanning)) |
| `--rule <name>` | every rule | only this rule; repeatable |
| `--service <name>` | every service | only violations this service is on either end of |
| `--fail-on <level>` | `none` | exit 1 on a violation, or a rule that could not be checked, at this level or worse: `none`, `error`, `warning` |
| `--max-nodes <n>` | `150` | most violations to print; the file is always complete |
| `--out <dir>` | the configured output | where to write `rules.json` |
| `--list` | off | print the configured rules with how many nodes each side selects |
| `--output <file>` | stdout | with `--format sarif`: write the log here and print one line about it |
| `--sarif-root <dir>` | the configuration's directory | with `--format sarif`: paths relative to this checkout ([SARIF](#--format-sarif-findings-for-code-scanning)) |
| `--sarif-level <level>` | `note` | with `--format sarif`: leave out results below `error`, `warning` or `note` |

Every run writes the whole report to `<output>/rules.json`
(`rulesFormatVersion: 1`): each rule with its status (`held`, `broken`,
`unchecked`) and how many nodes each side selected, every violation, the
excused ones, the rules that could not be checked and the notes. A violation
carries the rule, the two ends (`from`, `to`, by node id, and their services),
the path (each hop's edge type and `confidence`), `at` - the file and line of
the near end of the hop that crossed, where a fix goes - the weakest confidence
on the path and `heuristic` when that is a guess. Exit `0` means nothing at or
above `--fail-on`; `1` means something was; `2` means it could not run (no
graph, no rules configured, a rule that fails its schema).

A violation along a guessed edge is shown at its rule's severity and marked a
guess; it fails a run only with `rulesSettings.failOnHeuristic: true`. A rule
a side of which names a service, tag, table, channel or route the graph does
not hold is never a pass: it is listed as not checked, with
`rule-matches-nothing` and the nearest names, and fails at its severity. A rule
naming a service the build read in part says so on each answer
(`rule-over-partial-read`). The rules themselves are written under
[`rules`](#rules) in the configuration.

### `flowatlas shapes --suggest`

Which missing packages to describe in a shape file, and what of each the project
uses (P78). The packages are the `module-not-installed` part of what the reader
could not follow (`doctor --unresolved`), most places first; for each, the names
the services import from it, whether each is constructed, called or written as a
type, and the members read off it, off what it constructs and off whatever is
declared with it as its type. Those come from the repositories' files read as
syntax and kept as names: no other text of anybody's code is in the answer.

| Flag | Default | Means |
|---|---|---|
| `--suggest` | off | list the packages; without it, only the shape files the configuration lists and what each declares |
| `--top <n>` | 10 | most packages to list |
| `--service <name>` | every one | only the places of one service |
| `--package <name>` | every one | only this package |
| `--members <n>` | 12 | most names listed per package |
| `--out <dir>` | none | write a starter `.d.ts` per package listed into this directory |
| `--force` | off | with `--out`: write over a file that is there already |
| `--json` | off | the same as data (`shapesSuggestFormatVersion: 1`) |
| `--config`, `--db` | found | as for every reading command |

A package the configuration would already read in its place once rebuilt - its
source in a repository read here, or a listed shape file - is marked as covered.
The runtime's own declarations (`@types/node`) are not listed: install them.

`--out` writes one file per uncovered package, named after it
(`@acme/feature-flags` is `acme-feature-flags.d.ts`): a `declare module` block
per module specifier used, each export declared as the project uses it - a class
with the members read off it, a function, a value, a type, each with as many
type parameters as the project writes it with - and every type `any`,
with an index signature so a member it does not list is still there. Refine the
`any`s and list the directory under `shapes`; a call through a member still
typed `any` is then counted as `any-typed:<package>` rather than
`module-not-installed`. A file that is already there is kept (`--force` writes
over it), and a directory inside a repository the configuration reads is
refused: shape files are the project's, kept beside the configuration.

### `flowatlas patterns test | explain | suggest`

The author's side of the project's own extraction patterns (P121; the file
format is under [Your own extraction patterns](#your-own-extraction-patterns)).
All three read only, except `suggest --out`.

**`flowatlas patterns test [files...]`** runs every rule's `tests` - of the
files named, or of every file the configuration lists - by the reader the build
runs, in memory: each test's code is put in a file of its own, the names it
uses and does not declare are declared `any`, the receiver the rule is about is
given a stub of the rule's `receiverType` (so the reader's own type check is
what passes or fails), and a function the rule imports from `on.module` is
imported from it. Then the reader reads that file with the rule compiled into
its configuration, exactly as a build would. Per test it prints pass or fail,
what was drawn (`producer on channel:book.added`, `http_out POST /stock/reserve`),
the rows the code left and what each hole caught. Exit 0 when every test
passes, 1 when one fails, 2 when a rule or a file cannot be read.

| Flag | Default | Means |
|---|---|---|
| `--sample <file>` | none | run the rules over a file of code instead, and list every match |
| `--service <name>` | none | type the code against that service's own program: the test is read beside a file of the service that names the rule's type |
| `--rule <id>` | every rule | only this rule |
| `--show-descriptor` | off | print what each rule compiles to, as it would be written under `adapters` in `flowatlas.config.json`, for a team that prefers one file |
| `--json` | off | the same as data (`patternsTestFormatVersion: 1`); each rule's `descriptor` is always there |
| `--config` | found | the configuration whose pattern files are tested, and whose written descriptions a rule is read beside |

**`flowatlas patterns explain <place>`** holds every rule a service reads
against each call written at a place - `<service>/<file>:<line>`, `<file>:<line>`
with `--service`, or a gap id from `search` (`gap:<service>|<file>|<reason>`,
every place of that row) - part by part: the method's name, the receiver's type
(the checker's, or what the source states), each argument, each key, each
literal. A rule that fits says so; one that does not names the first part that
did not fit (`stops at receiver type: OtherBus`). A rule that does not compile
is listed as not tried, with why. `--json` gives `patternsExplainFormatVersion: 1`.

**`flowatlas patterns suggest`** reads the built graph's Can't follow places
under `call-dynamic-receiver`, `channel-dynamic`, `db-receiver-name-only`,
`api-client-unread` and `global-wrapper-dynamic`, opens each call, groups them
by the receiver's type and the method (or the function), counts every call of
the same method on the same type in the service, and writes a starter rule for
each group of at least `--min-sites`: the kind guessed from the names, a pattern
written from the first call's own shape, the fields it can place (`channel:
$TOPIC`), `TODO` where it cannot tell, and two tests from the first calls with
what the starter makes of them. Nothing a suggestion writes is read until it is
listed under `patterns`.

| Flag | Default | Means |
|---|---|---|
| `--min-sites <n>` | 3 | fewest calls a starter is written for |
| `--cause <cause>` | every one | only places of this reason or cause |
| `--service <name>` | every one | only the places of one service |
| `--out <dir>` | none | write each starter to `<dir>/<id>.yml`; a directory inside a repository the configuration reads is refused |
| `--force` | off | with `--out`: write over a file that is there already |
| `--json` | off | the same as data (`patternsSuggestFormatVersion: 1`) |
| `--config`, `--db` | found | as for every reading command |

`doctor --unresolved` names `flowatlas patterns suggest --cause <cause>` under
every cause whose rows are of those reasons.

### `flowatlas accept [reason-or-id]`

Accepts a gap somebody has looked at and decided to live with, so `doctor`, the
page and the graph server show only new ones. It writes `accepted.json` beside
`graph.db`.

```sh
flowatlas accept channel-dynamic --service billing --note 'one channel per tenant'
flowatlas accept 'gap:billing|src/events.ts|channel-dynamic'
flowatlas accept --list
flowatlas accept channel-dynamic --service billing --remove
```

| Flag | Default | Does |
|---|---|---|
| `--config <path>` / `--db <path>` | found from the working directory | which graph to accept against |
| `--service <name>` | every one | accept the reason only in this service |
| `--file <path>` | every file | only in this repository-relative file, or every file a glob names (`src/public/**`; see *Globs* below) |
| `--path <pattern>` | none | a route finding on every route a pattern names: `GET /api/public/*`, or `/api/public/*` for every method |
| `--note <text>` | none | why; required for a rule (`--path` or a file glob) |
| `--dry-run` | off | list what would be accepted and write nothing |
| `--remove` | off | stop accepting it |
| `--list` | off | print what is accepted |

The argument is a reason or a gap id, `gap:<service>|<file>|<reason>`, as the
graph server's `search` returns it. A reason on its own accepts it everywhere;
`--service`, `--file` and `--path` narrow it. A target no current gap matches is
refused, so a typo does not accept nothing silently. Accepting routes by rule
is described under `doctor` above.

**A rule's violations.** `rule:<name>` accepts violations of one architecture
rule: `--service` narrows it to those starting in a service, `--file` to those
crossing in a file (or a glob), `--path` to those with a route pattern at
either end, and `--note` is always required. `doctor`, `rules`, `diff` and the
graph server then list them as excused, never counted and never hidden.

```sh
flowatlas accept rule:only-orders-writes-orders --service billing \
  --note 'the backfill job, until it is done'
```

**A file that cannot be read.** An `accepted.json` that is not JSON (a merge
conflict, a truncated write), is JSON of the wrong shape (an entry without a
`reason`), or carries an `acceptedFormatVersion` this version does not know is
never read as empty and never written over. Adding and `--remove` exit 2,
naming the file and what is wrong with it, and leave it byte for byte as it
was; a file written by a newer flowatlas says to upgrade. `--list` and
`--dry-run` still run and say the problem first. Every surface that reads the
file - `doctor` (a warning line, and `unresolved.accepted.problem` in
`doctor.json`), `doctor --unresolved`, `shapes --suggest`, `visualise` (the
build output and the accepted bar) and the graph server's `cant_follow` and
`search` (a `note`) - says so and accepts nothing, so every gap is counted as
new until the file is fixed or moved. The file is written through a temporary
renamed into place, so an interrupted write leaves the old file whole.

**Globs.** One grammar, shared by an accepted `--file` rule and by `shapes`:
separators are `/` (a `\` is read as one); `*` is any run of characters within
one segment; `?` is one character within one segment; `**` as a whole segment
is zero or more segments, so `src/**/x.ts` matches `src/x.ts` as well as
`src/a/b/x.ts`, and `src/public/**` everything under `src/public`; `**` inside
a segment is two `*`; everything else, dots and brackets included, is literal.
A route pattern (`--path`, `doctor.publicRoutes`) is not a path on disk and
keeps its own rule: `*` is any run of characters, `/` included, so
`GET /api/*` covers `/api/a/b`.

### `flowatlas diff <base-ref> [head-ref]`

Builds the graph at two revisions and reports what moved: which nodes changed,
which entry points in which repositories reach them, and which contract findings
are new. Markdown by default, because its destination is a pull request comment.

| Flag | Default | Does |
|---|---|---|
| `--service <name>` | every one | compare only this repository, repeatable; with `--env`, the services that move (default: every one whose head differs from its pin) |
| `--env <name>` | none | the base side is what this environment runs, each service at its pin, in place of `<base-ref>`; the one ref given is then the head |
| `--pin <service>=<ref>` | none | with `--env`: the ref a service runs, over the pins file and `FLOWATLAS_PIN_<SERVICE>`, repeatable |
| `--pins <path>` | `deployed.file`, or `flowatlas.deployed.json` | with `--env`: the pins file |
| `--format <name>` | `markdown` | `markdown`, `json`, `sarif` (the new and fixed contract findings and rule violations, [SARIF](#--format-sarif-findings-for-code-scanning)) or `comment`: the Markdown as a pull request's comment, opening with three lines (what the change reaches, its new breaks and stale docs, the verdict) above the report, with a hidden marker that finds the comment again; its figures are written to `diff-comment.json` beside `diff.json` |
| `--section <name>` | every one | only this part of the Markdown, repeatable: `impact`, `flows`, `docs`, `contracts`, `api`, `rules`, `joins`, `gaps`, `types`, `graph`; without the heading, the side table and the footer, the warnings kept. `diff.json` is whole either way, and another `--format` is refused |
| `--output <file>` | none | write what was printed here as well; with `--format sarif`, the log goes here instead of stdout |
| `--sarif-root <dir>` | the configuration's directory | with `--format sarif`: paths relative to this checkout |
| `--sarif-level <level>` | `note` | with `--format sarif`: leave out results below `error`, `warning` or `note` |
| `--fail-on-contract-break` | off | exit 1 on a new contract error, or on a service neither ref could be read for |
| `--max-entries <n>` | 150 | ways in listed per changed node |
| `--max-nodes <n>` | 100 | changed nodes walked backwards from |
| `--max-flows <n>` | 50 | ways in walked for **Changed flows**; the rest are counted in a `flows-truncated` warning |
| `--max-diagrams <n>` | 5 | changed flows drawn; the rest are named and counted |
| `--context <n>` | 3 | unchanged steps kept on each side of a change; a longer run folds to `N unchanged steps` |
| `--sequence-detail <level>` | `service` | `service` or `class`: what a participant of a flow's diagram is |
| `--max-chars <n>` | 60000 | about the most characters of Markdown (a pull-request comment on GitHub holds 65,536): diagrams are dropped from the last one back, then whole flows, each counted, with `diff.json` named |
| `--no-diagrams` | off | list each changed flow's steps without its Mermaid diagram |
| `--spec` | off | also write both sides' OpenAPI and AsyncAPI documents in memory and add their changes, by kind, as **API changes** ([`spec diff`](#flowatlas-spec-diff-base-ref-head-ref)) |
| `--concurrency <n>` | cores | repositories read at once |
| `--no-cache` | off | read every commit again rather than believing the cache |
| `--keep-worktrees` | off | leave the detached checkouts on disk, for debugging |
| `--out <dir>` | configured output | where `diff.json` goes |
| `--head-db <file>` | none | keep the head side's graph at this file, for `docs --check --db <file>` or a query to read the branch as `diff` read it, without a second build; a pull request's run has no `graph.db` of its own |

Each service is read at the ref **in its own repository**. A service that is a
subdirectory of a repository rather than the root of one cannot be read at a
ref: the run says so in Warnings, the verdict names it, and
`--fail-on-contract-break` refuses rather than passing a comparison that did not
cover it.

**Against an environment.** `flowatlas diff --env prod [head-ref]` compares
with what prod runs rather than with one ref of every repository: the base side
is each service at the ref [`check --env`](#flowatlas-check---env-name) reads
it at (the pins file, `FLOWATLAS_PIN_<SERVICE>`, then `--pin`), the head side
the same with the services that move at the head ref or the working tree. The
document is the one a check carries under its verdict, without the verdict:
`diff.json`'s `base.ref` is the environment's name, and every section equals
`check.prod.json`'s `diff` but for the timings. The Markdown opens with the
pins (`| service | deployed | pinned by | head |`), the services the
environment does not run, and notes. A pin that does not resolve, an unknown
environment and a service in a subdirectory of a repository exit 2, naming
which repository to fetch: never read as the working tree in their place.
`<base-ref>` and `--env` are exclusive; `--pin` and `--pins` need `--env`.

Besides the impact and the contracts, the document says two things a renamed
route breaks that no compiler on either side sees. **Calls that stopped
joining** lists each request that joined a route on the base side and joins
nothing now, with what the head side says instead (`target-route-not-found`,
or `no-edge`), and each channel left with a consumer and no producer or the
other way round. **Gaps and findings** lists, by gap id
(`gap:<service>|<file>|<reason>`), the places the reading cannot follow and the
findings that the head has and the base does not, each with the method it is
in. A gap id is one reason in one file, so a second unjoined request in a file
that already had one keeps the id; the rows under an id both sides hold are
matched one by one on what each says (its symbol with positions masked, and its
message), never on its line, and the sites left over are listed under the same
id at the first new one (`gap, 1 more beside 1`). An id that lost sites is
listed under `removed` the same way, and one whose site was replaced by another
under both. The MCP server's `what_changed({verdict: true})` reads both.

**Changed flows**, after the impact, is the question a reviewer has about each
way in: what does this request do now that it did not do before. Every way in
the impact lists, and every way in the branch added or removed, is walked on
both graphs (16 hops, `maxNodes` 150, the same on each side) and read as a
sequence of steps, as `flow --format sequence` draws it. The two sequences are
matched step by step on what each step is - its two ends, its kind and its
label, never its line - so a step written five lines lower is the same step, and
one inserted in the middle is one addition. Each changed flow is a `<details>`
(the first open) whose summary says what happened (`POST /orders` (gateway) — 2
steps added, 1 changed; crosses gateway → orders → billing), a Mermaid sequence
diagram with added steps in green prefixed `+`, removed ones in red drawn with
the cross arrow and prefixed `−`, and changed ones in amber with a note naming
what changed (`body: +channel (required)`: the request carries, or its handler
takes, a type that changed shape), and under it the same steps as a `diff`
block, for a reader whose client does not render Mermaid. A way in only one side
has is drawn on that side alone, titled added or removed (a removed one read off
the base graph). The flows that changed most, across most services, come first;
ways in whose steps did not change are named on one line.

**Rules**, after the contracts, applies the head's `rules[]` to both graphs and
says which violations this revision introduced, fixed, left as they were and had
excused (the head's `accepted.json`), each keyed `rule|<name>|<from>|<to>` with
no line in it, so a violation that only moved down a file is the same one. The
section is left out when no rule has a violation on either side.
`--fail-on-rule-break` exits 1 on a new violation at `error` along edges that
are not guesses (with `rulesSettings.failOnHeuristic`, guesses too), and on a
service neither ref could be read for, as `--fail-on-contract-break` does.

With `--spec`, **API changes** follows the contracts: the table `flowatlas spec
diff` prints, every change of the two sides' documents by kind with the callers
it breaks.

**Docs this branch makes stale**, after the changed flows, lists each doc block
(see `flowatlas docs`) on the head side that no longer says what the head
graph says but did say what the base graph says, at its `file:line`, with the
steps added and removed under it, so a reviewer sees which pages to update in
the same pull request. Blocks that were stale before the branch are counted on
one line; a project without doc blocks gets no section. The head side's files
are read from the working tree, or at the head ref from the repository of the
service each is in. The section is in the Markdown only: `diff.json` is
unchanged by it.

`diff.json` is format 5 (`diffFormatVersion`). Format 2 added `unresolved`
(`{ added, removed }`, each row `{ id, kind, service, file, line?, reason,
node?, sites, kept? }`, `kind` `gap` or `finding`; `kept`, written since P194
without a format change, is set when both sides hold the id: the sites they
share, with `sites`, `line` and `node` those of the sites beyond them) and `joins` (`{ lost }`, each
`{ kind, caller, target, edge, service, targetService, now, targetRemoved }`,
`kind` `target-gone`, `no-producer` or `no-consumer`). Format 3 adds `flows`:
one per way in walked, `{ entry, label, service, side, reaches, participants,
steps, counts, truncated? }`, `side` `both`, `head` or `base`, each participant
`{ id, label, kind, service? }` (`kind` `caller`, `service`, `class`, `channel`,
`table`, `store` or `external`) and each step `{ status, kind, from, to, label,
confidence, file?, line?, params?, returns?, takes?, group?, note? }` (`status`
`same`, `added`, `removed` or `changed`; `kind` `enters`, `calls`, `http_calls`,
`hits`, `emits`, `consumes`, `queries`, `caches`, `triggers` or `stop`). Format
4 adds `rules`: `{ new, fixed, existing, excused }`, each a list of violations
as `rules.json` holds them. Format 5 adds `spec`: what `spec-diff.json` holds
with `--spec`, and `null` without it (not computed, which an empty list would
not say). Files of formats 1 to 4 are still read, without the sections they
predate; one from a newer flowatlas is refused by name.

A `no-producer` join whose `now` is `never-produced` is a consumer the head side
added to a channel nothing on the head side publishes: a join the base side
never made and the head side cannot make (P117).

### `flowatlas spec`

Writes an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document of each
service's routes and an [AsyncAPI 3.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
document of each service's channel ends, from what the graph already read: no
framework plugin, nothing run. Build first; `spec` reads the graph.

| Flag | Default | Does |
|---|---|---|
| `--service <name>` | every one | only this service, repeatable |
| `--kind <kind>` | `both` | `openapi`, `asyncapi` or `both`: only what each service has |
| `--out <dir>` | `<output>/spec/` | where the files go; a directory inside a configured repository is refused, except with `--check`, which writes nothing |
| `--format <name>` | `yaml` | `yaml` or `json` |
| `--depth <n>` | 8 | named types followed into a shape before it is cut |
| `--check` | off | write nothing; exit 1 when a file there differs from what would be written now, is missing, or is no longer written |
| `--inventory` | off | also write `inventory.md` (or `inventory.json`): every route and procedure with its guards, public mark, callers, tables written, channels published and failure statuses |
| `--no-verify` | off | do not read each document back |

Files are `<service>.openapi.yaml`, `<service>@<application>.openapi.yaml` for
a service with more than one application (one address space each), and
`<service>.asyncapi.yaml`. Each is the same bytes every run (keys in a fixed
order), so a repository can commit one and run `spec --check` in CI.

What goes in, and from where:

| In the document | From |
|---|---|
| paths and verbs | every `http` way in; `:param` is written `{name}` with the name the registration wrote (P34) |
| `parameters` | the path's values, and the query and header values the handler reads (P29) |
| `requestBody`, the `2XX` response | the request and answer types, expanded from the type registry into `components.schemas` (JSON Schema 2020-12) **through the contract check's wire rules**: a `Date` is a string with `format: date-time`, a field typed `undefined` is not there, `@Exclude()` drops a field, `@Expose({ name })` renames it, `@IsOptional()` on the receiving side accepts `null` |
| failure responses | `fails` grouped per status (P87); a helper's choices each under their status (P90); an exception whose status is worked out at run time under `default` |
| `operationId` | the handler's name |

The success answer is `2XX`: which success status a route answers with is not
something the graph reads. An AsyncAPI document has a `send` operation per
publish and a `receive` operation per consumer, each with its own message; the
channel is written by its address, the id without `channel:`.

Nothing unread is written as fact. A route whose path was not read, one that
answers every verb, and a second route on the same verb and path are left out
and counted under `x-flowatlas-omitted`; a shape that cannot be said is `{}`
with `x-flowatlas-unread` and the reason; the run prints both counts per
document. Every document is read back through flowatlas's own reader of its
format, which must find the routes and channel ends it was written from; a
mismatch is a bug in flowatlas, printed as such, and the run exits 2.

The `x-flowatlas-*` extensions:

| Extension | On | Says |
|---|---|---|
| `x-flowatlas-source` | operation | `file:line` it was read at, inside the service's repository |
| `x-flowatlas-confidence` | operation | the weakest of what it was read from (`static`, `declared`, `heuristic`…); a body or answer only a cast states is `heuristic` |
| `x-flowatlas-callers` | route, `receive` | the requests joined to it, or the publishers of what it receives, counted by service |
| `x-flowatlas-consumers` | `send` | the consumers of what it publishes, by service |
| `x-flowatlas-guards` | route | each check in front: `name`, `layer`, `where` (`global`, `module`, `controller`, `route`), `via`, `skippedBy` (P76) |
| `x-flowatlas-public`, `x-flowatlas-public-by` | route | open on purpose, and what says so: `@flowatlas-public <why>`, a decorator `doctor.publicDecorators` names, or `doctor.publicRoutes` |
| `x-flowatlas-unread` | schema, response, message | why it is `{}`: `any-typed`, `transformed`, `too-deep`, `type-not-found`, `external-type`, `type-unread`, `generic-unread`, `not-json`, `nothing-sent`, `ref-unparsed`, `answer-unread`, `status-unread`, `payload-unread` |
| `x-flowatlas-assumed` | response | every site of that status is the framework's default, written nowhere (P87) |
| `x-flowatlas-sources` | response | `throw`, `guard`, `pipe`, `interceptor` |
| `x-flowatlas-claimed` | body, response | only a cast says the type |
| `x-flowatlas-unnamed` | path parameter | the name is numbered, not the code's |
| `x-flowatlas-type` | component | the registry id it was written from |
| `x-flowatlas-envelope` | `receive` | how a delivery wraps the message: `{ path: 'Records[].body', text: true }` (R172) |
| `x-flowatlas-forwards-to` | `receive` | the channels a delivery hands the message on to |
| `x-flowatlas-expects-reply` | `send` | a request that waits for an answer |
| `x-flowatlas-channel-kind` | channel | `topic`, `queue`, … |
| `x-flowatlas-omitted` | document | the ends left out, by reason |

Not written: `servers` (a host is configuration, kept out of artefacts),
security schemes and OAuth flows, examples.

#### `flowatlas spec --against <service>=<file>`: a committed document against the code

A team that writes its document by hand asks the opposite of `--check`: does
the document still describe the code? `--against` (repeatable) reads the file
(YAML or JSON, OpenAPI 3 or AsyncAPI 2/3, the kind by its top key) through
flowatlas's reader of that format, writes it back in the code's normal form
(`2XX`, `{name}`, components by shape, not by name), writes the service's
document from the graph, and compares the two with
[`spec diff`](#flowatlas-spec-diff-base-ref-head-ref)'s catalogue - the
document as the base side, the code as the head. `--against shop` alone takes
the documents `services[].apiDocuments` lists; `shop@admin=<file>` compares
with the code of one application. Nothing is written into a repository; the
report is `spec-against.json` (`specAgainstFormatVersion: 1`) under the output:
`{ documents, changes, summary }`, `changes` and `summary` as `spec-diff.json`
holds them.

| Flag | Default | Does |
|---|---|---|
| `--format <name>` | `text` | with `--against`: `text`, `markdown`, `json` or `sarif` (`spec/<kind>` rules, command `spec-against`) |
| `--fail-on <level>` | `error` | `none`, `error` or `warning` |
| `--max-rows <n>` | 50 | most changes printed; the file is complete |
| `--output <file>` | none | write what was printed here as well; with `--format sarif`, the log goes here instead of stdout |

Read that way, each kind says one thing:

| Kind | Level | Says |
|---|---|---|
| `endpoint-removed`, `method-removed`, `channel-removed`, `channel-consumer-removed` | error (consumer: warning) | the document declares it; the code no longer answers it, placed at the document's line |
| `endpoint-added` | info | the code answers it; the document does not say it, placed in the code |
| `request-property-added-required`, `request-property-became-required` | error | the code requires a field or value the document does not declare, or lets a caller leave out |
| `response-property-removed`, `message-property-removed`, `…-became-optional` | error | the document promises a field the code does not send, or may leave out |
| `…-type-changed` | error | the two disagree on a field's type |
| `request-property-removed`, `optional-property-added` | warning, info | the document declares a value the code does not read; the code reads or sends an optional one the document does not declare |
| `response-status-added` | warning | the code can fail with a status the document does not declare (statuses the code only assumes or could not read are left out) |

Every operation a document declares is public by being declared, so a
promise the code does not keep is an error whether or not anything in the
project calls it. Not compared: descriptions (prose), guards (a document names
security schemes, the code guard classes) and `format`s, which a reader of a
document does not keep. The query and header values and failure statuses the
document declares are compared, from the document itself.
`flowatlas contracts` runs the same comparison for every document
`apiDocuments` lists, as a "spec against the code" section after the
boundaries (and in its SARIF log), writing `spec-against.json` beside
`contracts.json`; `--fail-on` there fails on a broken promise too. Its
`--format json` stays `contracts.json`'s format.

### `flowatlas spec diff <base-ref> [head-ref]`

Builds both revisions through the cache `diff` uses, writes both sides'
documents in memory and compares them operation by operation. Each change is
one kind of a fixed catalogue (the kinds are the SARIF `ruleId`s,
`spec/<kind>`), and carries the callers joined to it on the base side - which
no document differ can know.

| Flag | Default | Does |
|---|---|---|
| `--service <name>` | every one | compare only this service, repeatable |
| `--format <name>` | `text` | `text`, `markdown`, `json` or `sarif` |
| `--fail-on <level>` | `error` | `none`, `error` or `warning` |
| `--output <file>` | none | write what was printed here as well; with `--format sarif`, the log goes here instead |
| `--max-rows <n>` | 50 | changes printed; `spec-diff.json` is complete |
| `--depth <n>` | 8 | named types followed into a shape |
| `--sarif-root`, `--sarif-level` | | as for [`--format sarif`](#--format-sarif-findings-for-code-scanning) |
| `--no-cache`, `--keep-worktrees`, `--concurrency`, `--out` | | as for `diff` |

| Level | Kinds |
|---|---|
| breaking (`error`) | `endpoint-removed`, `method-removed`, `path-param-added`, `request-property-became-required`, `request-property-added-required`, `request-property-type-changed`, `response-property-removed`, `response-property-type-changed`, `response-property-became-optional`, `response-status-removed` (a success status), `channel-removed` (a publish), `message-property-removed`, `message-property-type-changed`, `message-property-became-optional` |
| `warning` | `request-property-removed` (callers still send it), `response-status-added` (a failure a caller may not handle), `security-added` (a guard now in front), `channel-consumer-removed` |
| `info` | `endpoint-added` (a route or a channel end), `optional-property-added`, `description-changed` |

Routes are matched by what a request is matched on, the verb and the path with
its parameters as `:param`, so renaming a parameter is no change. Fields are
compared as they go over the wire (both documents are written through the wire
rules) and to `--depth`; a side written as unread is not compared.

**Callers decide the level.** A breaking change with no caller in the project,
on a route nothing marks public, is a `warning` saying `no caller in this
project`; one with callers, or on a public route, stays an `error` with its
callers listed (service, `file:line`, confidence). Exit 1 when a change is at
or above `--fail-on`, or when a service could not be read at either ref.

`spec-diff.json` (`specDiffFormatVersion: 1`) is `{ documents: { base, head },
changes, summary: { errors, warnings, infos, breaking, uncalled } }`, each
change `{ kind, level, document, format, service, operation, field, base,
head, message, place, callers, public, note, confidence, key }`, `key`
`<kind>|<document>|<operation>|<field>`.

### `flowatlas export backstage|structurizr`

Also `dot`, `graphml`, `cypher` and `csv` (P237): the graph in the formats graph
tools read, every edge with how sure the graph is of it.

| Kind | Writes | Default `--level` |
|---|---|---|
| `dot` | `graph.<level>.dot`, for Graphviz: a line style per confidence (dashed a best guess, dotted an annotation, bold seen at run time), one cluster per service below the service level | `service` |
| `graphml` | `graph.<level>.graphml`, for Gephi and yEd: `type`, `service`, `confidence`, `count`, `observed` declared as keys | `node` |
| `cypher` | `graph.<level>.cypher`, for Neo4j and Memgraph: a constraint, then nodes and edges `MERGE`d in batches, so it is safe to run twice | `node` |
| `csv` | `nodes.<level>.csv` and `edges.<level>.csv` in `neo4j-admin import`'s header form, which any loader reads | `node` |

`--level service|class|node` draws each service as one node (the edges between
two summed, as sure as the least sure of them), each class, or every node.
`--from <entry>` (repeatable) keeps only what those ways in reach, walked as
`flow` walks them: the same edges, and as deep as `flow` goes from that entry
(eight hops, and one more per step of a workflow) unless `--depth <n>` says.
`--max-nodes` (400) bounds each walk. What either bound left out is counted in
nodes, each once however many walks cut it, on the line the run prints (`; 12
more past --max-nodes and 4 more past --depth left out`) and in each file, as
a comment (a `<desc>` in GraphML). `--service` keeps one service. `--check` works as it
does for the other kinds. How to load each is in [the files flowatlas
writes](formats.md), with the JSON Schemas of its own files.

Writes the map into the tools that already hold one: a
[Backstage](https://backstage.io/docs/features/software-catalog/descriptor-format)
catalogue whose relations are the joins the graph made, or a
[Structurizr DSL](https://docs.structurizr.com/dsl/language) workspace with a C4
container view and one dynamic view per flow. Build first; `export` reads the
graph, writes only into the output directory, and sends nothing anywhere.

| Flag | Default | Does |
|---|---|---|
| `--out <dir>` | `<output>/export/<kind>/` | where the files go; a directory inside a configured repository is refused, except with `--check`, which writes nothing. The catalogue's own repository is fine when it is not a configured service |
| `--service <name>` | every one | only this service, repeatable: its entities (or the joins touching it) and what they reach |
| `--include-heuristic` | off | also draw joins the linker only guessed (`heuristic`, `runtime`), marked as such |
| `--check` | off | write nothing; exit 1 when a file there differs from what would be written now, is missing, or is no longer written, printing the first line each differing file gained (`+`) and lost (`-`) with the entity and field it is under |
| `--json` | off | print what would be written as data: the entities (Backstage) or the model (Structurizr), and the summary |
| `--flow <entry>` | the ranked flows | structurizr only: draw this way in, repeatable, in the order given |
| `--max-flows <n>` | 10 | structurizr only: most dynamic views |
| `--max-labels <n>` | 3 | structurizr only: labels a relationship lists before it says `+N more` |

Only `static`, `declared` and `marker` joins are drawn by default. Every file is
the same bytes every run (sorted, no timestamp), so a repository can commit the
export and run `--check` in CI ([ci.md](ci.md#a-committed-catalogue)).

**Backstage.** One file per service, `<service>.yaml`, holding its `Component`
and its `API`s; `resources.yaml`; the OpenAPI and AsyncAPI documents the APIs
point at (written as [`spec`](#flowatlas-spec) writes them); and
`catalog-locations.yaml`, one `Location` listing every entity file, so one
registration in Backstage picks them all up.

| Entity | Written from |
|---|---|
| `Component` per service | `spec.type` `service`, `website` (a browser repository) or `function` (every way in a function or workflow reached by name); `lifecycle`, `owner`, `system`, `description` from `services[].catalog`; an owner or lifecycle nobody gave is `unknown` and the run lists the services, a system nobody gave is left out |
| `API` per service and kind | `<service>-openapi` for a service with routes, `<service>-asyncapi` for one that publishes; `definition` is `$text: ./<service>.openapi.yaml`, or an inline list of the operations when there is no single document (two applications, say) |
| `providesApis` | the service's own APIs |
| `consumesApis` | a request into another service's route (`http_calls`, `hits`): that service's OpenAPI API; a delivery off a channel another service publishes (`consumes`): the publisher's AsyncAPI API. A channel nothing in the project publishes names nothing, and the run lists it |
| `dependsOn` | `resource:<table>` for every table queried; `resource:<host>` for every host outside the project called; `component:<service>` for a function or workflow of another service started by name |
| `Resource` per table | `spec.type: database`, one per table name, owned by the owner of the service that writes it (the first by name when two do; the run says so), `flowatlas/written-by` and `flowatlas/read-by` naming the services |
| `Resource` per host | `spec.type: external-api`, owner `unknown` |

Annotations: `flowatlas/graph-id` (the node ids), `backstage.io/source-location`
only from `services[].catalog.sourceUrl` (never guessed), and, because a
Backstage relation holds no attributes, `flowatlas/heuristic-relations` on an
entity naming the relations drawn from a heuristic join only, and
`flowatlas/confidence: heuristic` on a resource only such joins reach. A name a
catalogue cannot hold (`[a-z0-9]` words joined by `-`, `_` or `.`, at most 63
characters) is normalised and the original kept as `title`.

**Structurizr.** `workspace.dsl`: a `softwareSystem` named for the project (the
one `catalog.system` every service shares, else the configuration's directory)
holding a container per service (technology: its `type`), a container per
service with tables (`<service> store`, tag `Database`) and a container per
channel prefix (`order messages` for `order.created`, tag `Queue`); each host
outside the project is a `softwareSystem` beside it (tag `External`), and a
`person "User"` uses each browser repository.

| Relationship | Description | Technology |
|---|---|---|
| a request into another service | `POST /invoices` | `HTTP` |
| a function of another service started by name | `invokes nightly-report` | `Invoke` |
| a publish, and a delivery | `publishes order.created`; `delivers order.created` (queue to consumer) | `Messaging` |
| a query | `writes orders`, `reads invoices`, `reads and writes orders` | `SQL` |
| a call outside the project | `POST /v1/charges` | `HTTP` |

One relationship per pair and kind, its labels sorted and cut at `--max-labels`
with `+N more`; one drawn only from heuristic joins is tagged `Heuristic`. Then
`container <system> "Containers" { include * autolayout lr }`, one `dynamic`
view per flow, and a `styles` block giving `Database`, `Queue` and `External`
their shapes. Flows are walked as [`flow --format sequence`](#flowatlas-flow-entry)
walks them, from every way in and every browser action, and ranked by the
services they cross; a dynamic view holds the cross-container steps in call
order, only on relationships of the model (a step on a heuristic join, a cache
read or a caller the model does not hold is left out and counted). A way in
whose flow never leaves its container gets no view, and two ways in that draw
the same steps (a route and the function behind it) get one. The run counts
what `--max-flows` and `--max-labels` cut.

Neither Backstage nor the Structurizr CLI runs here: every file the snapshots
and tests hold is checked against Backstage's entity rules (envelope, kind
fields, names, references, annotation keys) and the DSL statements written
(identifiers defined once before use, every dynamic step on a relationship of
the model, quotes escaped, blocks closed), by `catalogProblems` and
`dslProblems` of `@flowatlas/linker`.

### `flowatlas check --env <name>`

Can this be deployed there. `diff` compares a branch with `main`; a release
pipeline needs it compared with the versions **running** where it ships, and
`main` of another service is often ahead of those. `check` reads every service
at the ref an environment runs (the *deployed* side), puts the version being
shipped in place of its own (the *candidate* side), runs what `diff` runs on the
two - the node, type and flow diff, the contracts, the rules, the joins - and
answers `deployable` or `not deployable`.

```sh
flowatlas check --env prod --service orders --head release/1.9
```

| Flag | Default | Does |
|---|---|---|
| `--env <name>` | required | the environment to check against, repeatable: one section each, the exit is the worst |
| `--service <name>` | every service whose head differs from its pin | a service being shipped, repeatable |
| `--head <ref>` | the working tree | the ref the shipped services are read at |
| `--pin <service>=<ref>` | none | the ref a service runs, over the pins file and the variables, repeatable; applies to every `--env` |
| `--pins <path>` | `deployed.file`, else `flowatlas.deployed.json` beside the configuration | the pins file |
| `--format <name>` | `text` | `text`, `markdown` (the verdict above `diff`'s whole document), `json` (the check document; an array for several environments) or `sarif` |
| `--output <file>` | none | write what was printed here as well; with `--format sarif`, the log goes here instead of stdout |
| `--sarif-root <dir>`, `--sarif-level <level>` | as `diff` | with `--format sarif` |
| `--max-entries`, `--max-nodes`, `--max-flows`, `--concurrency`, `--no-cache`, `--keep-worktrees`, `--out` | as `diff` | |

**The pins file**, `flowatlas.deployed.json`, committed beside the configuration
like the baseline:

```json
{
  "deployedFormatVersion": 1,
  "environments": {
    "prod":    { "orders": "v1.8.0", "billing": "v2.3.1", "gateway": "4f1c2a9" },
    "staging": { "orders": "main", "billing": "main", "gateway": "main" }
  }
}
```

A ref is anything `git rev-parse` resolves in that service's repository: a
tag, a branch, a sha. A service missing from an environment is not deployed
there: it is on neither side and listed as such (unless `--service` names it,
when it is read on the candidate side only, a first deploy). A service no
configuration names is refused when the file is read. A pipeline that knows the
running versions needs no file: `--pin orders=v1.8.0`, or the variable
`FLOWATLAS_PIN_ORDERS=v1.8.0` (the service name upper-cased, every other
character `_`). A variable wins over the file, a flag over both, and the
document's notes say whose ref was used in place of whose.

**The candidate side** moves the services `--service` names to `--head` (the
working tree when absent); one whose head is its pin is "nothing to deploy for
orders" and stays as deployed. Without `--service`, every pinned service whose
head is a different commit moves, and one with uncommitted changes when the head
is the working tree.

**The verdict** counts only what deploying introduces against the deployed side:

- a new contract error;
- a new violation of an architecture rule at `error` (a guessed one only with
  `rulesSettings.failOnHeuristic`);
- a join deploying loses (`lostJoins` with the deployed side as base): a call a
  deployed service makes to a route the candidate no longer serves, with the
  caller's file and line; a channel left with consumers and no producer, or the
  other way round; a new handler of a channel nothing deployed publishes;
- a new request that joins no route anything deployed serves.

A reason along a guessed edge still counts and says so. What the deployed side
already does wrong - a contract error, a rule violation - is listed under
**Already deployed** and never fails the run.

| Exit | Means |
|---|---|
| 0 | deployable (or nothing to deploy) |
| 1 | not deployable |
| 2 | could not decide: an unknown environment, a pinned ref that does not resolve (fetch the tags first: the message names the repository and `git fetch --tags`), a service that is a subdirectory of a repository, or a `--head` a named service does not have |

Unlike `diff`, a ref that does not resolve is never read as the working tree in
its place: that answer would be about a project nobody deployed.

Every environment leaves `<output>/check.<env>.json` (`checkFormatVersion: 1`):
`{ checkFormatVersion, generatedAt, environment, pinsFile, pins: [{ service,
ref, from: file|env|flag, sha, replaced? }], notDeployed, moved: [{ service,
from: { ref, sha }, to: { ref, sha, dirty } }], head, verdict: { verdict,
reasons, already, undecided, notes }, diff }`. Each reason is `{ kind:
contract|rule|join, code, message, key, service, at?: { service, file, line? },
confidence, heuristic }`; `diff` is a whole `diff.json` (deployed as `base`,
the environment as its ref; candidate as `head`), or null when the run could not
decide. The graphs come from the same `<output>/cache/` as `diff`'s, so a tag
read once is read once.

### `flowatlas deployed set|show`

The pins file, kept by hand or by a pipeline after a deploy. Nothing in a
repository is touched; `set` writes the pins file and nothing else.

| Command | Does |
|---|---|
| `deployed set <env> <service> <ref>` | records `ref` as what `env` runs of `service`, every other pin kept; `--resolve` records the commit it names, so the file says what ran rather than a branch that will have moved |
| `deployed show [env]` | each pin with its commit, its kind (`sha`, `tag`, `branch`, or `missing`) and its age; a branch is warned about, and so is a ref the repository does not have; `--json` for the same as JSON |

Both take `--config` and `--pins`.

### `flowatlas cache <action>`

The graphs `diff` keeps per commit, so comparing the same base twice reads it
once. `ls`, `prune` or `clear`.

| Flag | Default | Does |
|---|---|---|
| `--out <dir>` | configured output | the output directory holding the cache |
| `--keep <n>` | 10 | entries `prune` keeps, newest first |
| `--max <n>` | all | most rows to print |
| `--json` | off | print the answer as JSON |

### Mentions and notes

Beside its blocks, `flowatlas docs` reads the names a page mentions in code
(P234): every code span, and every line of a fence with no language or `text`.
One that names exactly one node - a route said aloud, an id, a channel, a
deployed function, a dotted label - links the page to the node, with the heading
above it. One that is clearly the graph's and names nothing - a route said
aloud, an id of a kind the graph writes, `Class.method` of a class the project
has - is a page naming what was renamed or removed, and is counted. Prose is
never read, and neither is a fence tagged with a language, whose names are an
example's.

| Flag | Does |
|---|---|
| `--mentions` | with `--list`, every mention and every dead one, with the nearest names; with `--check`, also exit 1 on a dead one; with `--format github`, an annotation per dead one |

A comment directly above a declaration whose first word is a tag - `WHY:`,
`NOTE:`, `DECISION:`, `HACK:`, `SEE:` (`docs.commentTags` sets others) - is kept
on that node's `meta.notes`, three at most, each up to 300 characters, over the
decorators between them; `@see page.md` in a doc comment is `SEE: page.md`, and
links the page. `flowatlas explain` and `describe_for_prompt` write them under
**Why**. `build` refreshes `docs.json` when the configuration has `docs`, so the
tools name mentioned pages without a separate run.

### `flowatlas report`

The page a person reads first (P228): what the project is, written from the
graph, every row with where it is.

```sh
flowatlas report                          # print it
flowatlas report --output .               # write ARCHITECTURE.md here
flowatlas report --sections crossings,second-look
flowatlas report --format json            # the model, with its fingerprint
```

| Section | Says |
|---|---|
| `services` | each service, what it is (a browser, an API, functions, a worker, a library), its ways in by kind, and how many were read to the end |
| `crossings` | what crosses from each service to each other one: requests, messages through a channel, store use, and how many of them are best guesses; drawn as a Mermaid flowchart |
| `load` | what most of the project depends on: methods by how many ways in reach them and from how many services, routes by callers elsewhere, channels by handlers, tables by the services that write them |
| `second-look` | a pair of services joined by a single thread, a store two services write, and a best guess on the way of many ways in (the threshold is the 90th percentile of reach, at least 3, and is said) |
| `not-read` | what the reading could not follow, grouped by cause, each with what to do |
| `checks` | contract breaks, architecture rules broken, cycles across services, dead ways in, routes with no guard, likely N+1 queries, channels with one end, types two services disagree about, each with the command that lists them |
| `run-time` | what traffic never touched and what it reached that no reader drew, when something was observed |
| `questions` | the next things to ask, built from the rows above, each as a command and as the graph server's call |

Nothing in it is inferred, clustered or summarised in prose. The services are
the groups, as the configuration declares them, and load is ranked by reach,
not by how many lines point at a thing, which mostly counts loggers. `--top`
(10) bounds each list and says how many it left out; `--service` keeps what
touches one service. A graph `doctor` would refuse is refused here too (exit 2).

The same page is the graph server's `flowatlas://overview`, and a doc block
keeps a committed one true:

```md
<!-- flowatlas:overview sections="services,crossings" -->
<!-- /flowatlas:overview -->
```

`flowatlas docs --write` fills it, with its headings two levels down, and
`flowatlas docs --check` fails when the project's structure changed since: a
service, which pairs cross and by what kind, a store two services write, a
single thread. A count moving, a route added, does not fail it, or the page
would be red every week. `sections` takes the names above; `service` keeps one
service.

A store two services write is also a `doctor` note (`store-shared`), one row
per writer, whose hint is the `only` rule a team writes when it is not the
design.

### `flowatlas docs [paths...]`

Markdown kept true to the graph. A page names a flow, a channel or a symbol in
a block of two HTML comments - invisible wherever Markdown is rendered - and
`flowatlas docs --write` fills the space between them from the graph:

```md
<!-- flowatlas:flow id="POST /orders" view="sequence" -->
<!-- /flowatlas:flow -->
```

becomes the diagram `flow --format sequence` draws, with the closing marker
holding a fingerprint of what the diagram shows and, one per line, the steps
it covered:

```md
<!-- flowatlas:flow id="POST /orders" view="sequence" -->
…the diagram…
<!-- /flowatlas:flow fingerprint="4bb04c97"
["enters","caller","orders","POST /orders","",["type:@fx/contracts#CreateOrderDto"],"type:@fx/contracts#OrderDto"]
["emits","orders","channel:order.created","order.created","",["type:@fx/contracts#OrderDto"]]
-->
```

`flowatlas docs --check` then fails a pipeline when the flow a block describes
has changed since it was written, and says which steps were added or removed.
The fingerprint is of what the block shows, not of its text: node ids without
their positions, how each was reached and how sure the graph is, the type ids
carried in and out, in walk order, and the steps between services. Moving code
down a file or reformatting it changes nothing; a new step, a removed one or a
changed shape fails the check.

| Flag | Default | Does |
|---|---|---|
| `[paths...]` | `docs.files`, else every `*.md` under the configuration | Markdown files, directories or globs to read |
| `--check` | off | exit 1 when a block is `changed`, `gone` or `ambiguous`; 2 when a marker cannot be read |
| `--write` | off | regenerate the content between the markers of every block that names one node, in place |
| `--list` | off | every block with its id, view and state |
| `--format <name>` | `text` | `text`, `json`, or `github` (a `::warning` at each stale block's opening line) |
| `--config <path>`, `--db <path>` | found from the working directory | the project and the graph |

**Blocks.** `flow` names a way in, `channel` a channel (publishers and
handlers), `symbol` any node (what reaches it and what it reaches). `ref`
holds nothing: `<!-- flowatlas:ref id="orders#src/orders/orders.service.ts:OrdersService.create" -->`
before a mention in prose is checked to still name a node. An `id` is a node
id, an entry said aloud (`POST /orders`, `bot:order_confirm`), or a name that is
exactly one node's label; a channel may be named without `channel:`. A name
that matches nothing is never re-pointed at the nearest one: the block is
`gone`, with the nearest names. Attributes: `view`, `depth`, `max-nodes`
(default 60; 120 for `prompt`), `detail` (0 to 2, default 1) and `service`,
which says which service's route a name means when two serve it.

**Views.**

| View | What is written |
|---|---|
| `steps` (default) | the tree `flow` prints, in a `text` block |
| `mermaid` | the flowchart `flow --format mermaid` draws |
| `sequence` | the sequence diagram `flow --format sequence` and `diff` draw |
| `prompt` | the Markdown `describe_for_prompt` answers with and the page copies, its headings two levels down |
| `contract` | a table of each crossing with what it sends, gets back and what the handler takes, each shape's fields, and what the way in can fail with |
| `tour` | a numbered walkthrough, one line per step with its service and `file:line`, and a note slot under each |

**Tours.** Each step line carries its key (`<!-- step key="…" -->`, the node id
without a position). Whatever is written under a step line is that step's
note, and a regeneration puts it back under the step with the same key,
wherever the step now is. A note whose step left the flow is kept at the end of
the block under **Orphaned notes**, never deleted, and returns to its step if
the step does.

**States.** `ok`: the fingerprint is the graph's. `changed`: it is not, with
the steps added (`+`) and removed (`-`) since; a block written by hand, with no
fingerprint, is `changed` until it is written once. `gone`: the id names
nothing, with the nearest names. `ambiguous`: it names more than one node, each
named; nothing is written into it. A marker that cannot be read (unclosed,
opened inside another block, an unknown kind, attribute or view) is reported
with its line and its block skipped. Markers inside a fenced code block or a
code span are text about markers and are ignored.

**What it writes.** Only `--write` writes, only between flowatlas markers, only
in the files named or configured, and nothing when the content is already what
it would write. Every run writes `docs.json` beside the graph
(`docsFormatVersion: 1`: `files` read; `blocks`, each with `file`, `line`,
`kind`, `id`, `node`, `view`, `options`, `state`, `fingerprint`, `near`,
`candidates`; and `problems`, the markers that could not be read, each `{ file,
line, message }`), which the MCP server and `flowatlas visualise` read to say which
documents describe a node.

---

### `--format sarif`: findings for code scanning

`contracts`, `dead`, `cycles`, `rules`, `doctor` and `diff` write their
findings as one SARIF 2.1.0 log, the format GitHub code scanning (and most
other code hosts) reads: each result is shown on the line it is about in a
pull request, stays open while the finding is there, and closes when it is
fixed. The log goes to stdout, or with `--output <file>` to the file, with one
line on stdout saying how many results of each level it holds. Uploading it is
the CI's job (`docs/ci.md`, "Code scanning"); flowatlas sends nothing anywhere,
and the format never changes an exit code.

Each command is one run under its own category, `automationDetails.id`
`flowatlas/<command>/`, so a job that uploads `doctor` and `contracts` keeps
two lists of alerts and neither upload closes the other's.

**Rules.** Every `ruleId` is a code flowatlas already uses, and the log lists
only the rules its results use, described from the same catalogue as the text
report's hints:

| `ruleId` | From | Level |
|---|---|---|
| a doctor reason (`dynamic-http-url`, `route-unguarded`, …) | `doctor`'s unresolved rows | gap or finding at `action` → `warning`, at `info` → `note`; a note row (P81) and a place with nothing to join are never written |
| `target-route-not-found`, `unknown-base-url-env`, … | `doctor`'s desync rows | `error` (said once, not again under its reason) |
| a marker code (`marker-emits-without-emit`, …) | `doctor`'s annotations | the marker's own: `error` or `warning` |
| `no-way-in` | `doctor`: a service nothing enters | `warning`, at the configuration line naming it |
| `missing_required`, `type_mismatch`, `optionality_mismatch`, `extra_field` | `contracts`, `doctor`, `diff` | the finding's severity, `info` → `note` |
| `rule/<name>` | `rules`, `doctor`, `diff` | the rule's severity, `info` → `note` |
| `dead-entry`, `dead-channel`, `dead-provider`, `dead-field` | `dead` | `note`; only actionable entries and `dead` / `likely-dead` verdicts |
| `cycle` | `cycles` | `warning` |

**Where.** A path is written as the configuration's directory sees it: a row's
file under the directory its service's repository is in (`billing/src/x.ts`),
which is the path in a checkout of the whole project and the one
`doctor --format github` annotates. `originalUriBaseIds` names the root
(`%SRCROOT%`) and each service's directory under it. A contract finding is at
the sender's line with the receiver as a related location, linked from the
message; a rule violation is at its crossing hop with the target related and
its path as a code flow; a cycle is at the node it starts from with its hops as
a code flow; a route `dead` reports keeps the requests that could still reach
it as related locations. A row with no line is placed at its file with no
region, never at a guessed line; one with no file at the line of
`flowatlas.config.json` naming its service, or its rule.

For a project of several repositories uploaded one repository at a time,
`--sarif-root <dir>` writes every path relative to that checkout, and leaves out
a result whose place is in another one, counted in a notification
(`results-elsewhere`); run once per repository with its own directory.

**Fingerprints.** `partialFingerprints["flowatlas/v1"]` is a hash of the key
the baseline already uses for that kind of finding - `unresolvedKey` for a
doctor row, `findingKey` for a contract finding, a rule violation's key, a
node id without its line for a dead row, a cycle's members - and
`primaryLocationLineHash`, the one GitHub matches alerts on, is written from
the same key with `:<n>` counting results that share it. None carries a line,
so moving a finding keeps its alert; changing what it is about makes a new one.

**Baseline and excuses.** `doctor` marks a row or rule violation the baseline
holds `baselineState: "unchanged"` and one it does not `"new"`. A row
`accepted.json` names, a violation it excused (`accept rule:<name>`) and a
contract finding `@ContractIgnore` or `contracts.ignoreEdges` excused are
written with `suppressions` (`external`, or `inSource` for the annotation) and
the note, so code scanning shows them dismissed rather than new. `diff` writes
only what the revision did: the contract findings and rule violations it
introduced (`new`, on the head side) and the ones it fixed (`absent`, where
they were on the base side).

**Size.** A log holds at most 5,000 results, the most severe first (what code
scanning shows of a run), unless `--max-nodes` (`--max` on `dead` and
`cycles`) says otherwise, and never more than 25,000 (what it accepts); with
`--format sarif`, `doctor` names every place up to that bound rather than six
per reason. A cut is said in `invocations[0].toolExecutionNotifications`
(`results-cut`) with how many were left out and the JSON file that has them
all. `--sarif-level warning` leaves the notes out.

## Configuration

Every key of `flowatlas.config.json`. Only `services` has no default.

### `services[]`

| Key | Type | Default | Means |
|---|---|---|---|
| `name` | string | required | what this service is called everywhere else |
| `repo` | string | required unless `document` is given | path to the repository, relative to this file or absolute. A service has a `repo` or a `document`, never both |
| `type` | string | required for a repository | which reader opens it: `nestjs`, `medusa`, `nextjs`, `sveltekit`, `nuxt`, `remix`, `react-router`, `express`, `fastify` or `koa` for anything with a server in it, `lambda` for functions whose ways in are declared in Terraform, `angular`, `react`, `vue` or `svelte` for a repository that is only a browser. Anything else is skipped and `build` says which type to set |
| `baseUrlEnv` | string[] | `[]` | settings keys other services use to address this one |
| `apiBaseEnv` | string[] | found in the environment files | for a browser: which of its settings keys hold an address, when they are not found |
| `hosts` | string[] | `[]` | hosts this service is reached at, as `host` or `host:port` (`["orders.example.com"]`), for a base address read from a repository's files to be matched against beside the service's name |
| `aliases` | string[] | `[]` | other names the service is known by: the short name an annotation uses (`@CallsService('catalog', …)` for `catalog-api`), the name its worker is deployed under (a service binding's target), a host. Wherever a service is named — an annotation, `apiTarget`, a binding, a base address's host — an alias is the service. Unique across every name and alias; matched exactly, never by prefix |
| `tags` | string[] | `[]` | names an architecture rule can select the service by: `frontend`, `edge`, `domain:payments`. A tag is a name only; nothing is inferred from it ([`rules`](#rules)) |
| `catalog` | object | none | what a software catalogue says of the service and the code cannot, for [`export`](#flowatlas-export-backstagestructurizr): `{ "owner", "lifecycle", "system", "description", "sourceUrl" }`, every key optional. Written as given; an owner or lifecycle nobody gave is `unknown`, and nothing is guessed from the code |
| `apiTarget` | object | `{}` | for a browser: which service each of those keys points at, as `{ "apiUrl": "admin-api" }` |
| `document` | object | none | a document that *declares* this service, for an end nothing here can read: `{ "kind": "openapi" \| "asyncapi" \| "graphql", "path": … }`, path relative to this file; a `graphql` document is SDL or an introspection result |
| `openapi` | string | none | the older spelling of `{ "kind": "openapi", "path": … }`, still read |
| `apiDocuments` | object[] | none | API documents the repository commits by hand, each compared with the one written from the code by `contracts` and [`spec --against`](#flowatlas-spec---against-servicefile-a-committed-document-against-the-code): `[{ "kind": "openapi" \| "asyncapi", "path": …, "application"? }]`, path relative to this file. Nothing is taken from them; refused on a service a `document` declares |
| `tsconfig` | string | found in the repository | which TypeScript configuration to parse with |
| `bootstrap` | string | `src/main.ts` | the application entry file, when it is elsewhere |
| `infra.vars` | string[] | none | for a service read from Terraform: the variable files a deployment is read with, in order, relative to the service's directory (`["infra/env/dev.tfvars"]`). Without it, a name two files set differently is reported, never picked |
| `readTestDirectories` | string[] | `[]` | directories named like tests (`test`, `tests`, `e2e`, `fixtures`, `cypress`, `playwright`, `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`) that hold code the application runs, relative to the service's directory: `["src/fixtures"]` |
| `builtInShapes` | boolean | project setting | whether the reader's built-in declaration shapes stand in for packages this service has not installed; `false` turns them off for this service alone |
| `shapes` | string[] | none | shape files this service reads beside the project's, as paths or globs relative to the configuration (the grammar under `accept`, *Globs*); added to the project's list |
| `patterns` | string[] | none | pattern files this service reads beside the project's, as paths or globs relative to the configuration; added to the project's list |
| `packageSources` | boolean or `"services"` | project setting | where this service reads the source of a package it has not installed; overrides the project setting |

**A directory named like tests is not read, and says so.** Test code is left out
of every graph: a file whose name marks it (`a.test.ts`, `a.spec.ts`,
`a.integration-test.ts`, `a.e2e.ts`) silently, and a directory with one of the
names above with one `test-directory-skipped` row, at level `info`, naming the
directory and how many source files it held. The name is a guess that is right
for nearly every repository. When it is wrong, because a `fixtures` or `e2e`
directory holds code the application runs, name it under `readTestDirectories`
and it is read like any other.

**`baseUrlEnv` is what turns a request into an edge.** When a request's address
is rooted at one of these keys, it resolves to that service's route. A key two
services both claim resolves to neither, and says so.

**A function URL needs no `baseUrlEnv`.** A request rooted at a setting no
service claims - `fetch(process.env.CARD_LOOKUP_URL + '/cards')`, or the same as
a template - is asked of the functions that run it: one deployed with that
setting set to a function URL (`aws_lambda_function_url.x.function_url`,
directly or through a module's output) reaches that function's `ALL /*` entry,
`via: "functionUrl"` with the setting as `meta.variable`. The edge is `static`
where the path was read and `heuristic` where it was not, since the URL answers
every path either way (`fixtures/lambda-terraform-destinations`).

**A setting nobody claims is read from what the repositories write down.** Where
no service lists the setting under `baseUrlEnv` and it holds no function URL, its
value is looked for, strongest first: the environment a function that runs the
request is deployed with (that alone, where it says); otherwise the files at the
top of the caller's repository - `.env.example`, `.env.sample`, `.env.template`,
`.env.development`, the `environment:` and `env_file:` of the compose container
built from it (in its own `docker-compose*.yml` or one beside this file),
`serverless.yml` `provider.environment` and `functions.*.environment`, and a
worker's `wrangler.json`, `wrangler.jsonc` or `wrangler.toml` `vars` - and the
code's own fallback, `process.env.X ?? 'http://…'`, `|| '…'`,
`config.get('X', '…')`, or a settings factory's (`registerAs('orders', () => ({
url: process.env.ORDERS_URL ?? '…' }))`, which also makes `orders.url` the
variable `ORDERS_URL`). `.env`, `.env.local` and the files for any other
environment are read for the names they set and never for a value. Only an
address is kept, and of it only the scheme, the host and the path: a setting
whose name says it is a secret, a value with credentials, a query or a token in
its path, and anything that is not an `http`, `https`, `ws` or `arn:` address are
dropped before anything is stored.

The host is then matched against the configured services: a service's name, its
`hosts`, the names a compose file gives the container built from it, and
`localhost:<port>` for a port the compose file publishes or the service's own
example files run it on. One service named by every value is the answer, joined
`via: "baseUrlValue"`, `heuristic` (`static` where the value is the one the
function is deployed with), with `baseUrl` and `baseUrlFrom` on the edge and on
the request and one `base-url-from-files` row at level `info` per value taken. A
host outside the project is a third party, drawn as one. Values naming two
services, or none, stay an `unknown-base-url-env` row that says which values
were found where, and which files set the setting without being read. A setting
nothing gives a value whose name is the name of exactly one service
(`ORDERS_SERVICE_URL` for `orders`) is taken as that service, `heuristic`, with
a `base-url-from-name` row; a browser's request is not, because `apiTarget` is
what names its service. `settingFiles.read: false` turns all of it off;
`settingFiles.environment` chooses one environment where files name several
(`fixtures/multi-repo-base-urls`).

**A value that is a whole address is where the request goes.** A request made
to exactly what a setting holds — `fetch(process.env.REINDEX_URL, { method:
'POST' })` — or to it plus a suffix, whose value has a path
(`https://catalog.internal/items/reindex`), asks for that path: it is joined to
`POST /items/reindex` of the service the host names, `via: "baseUrlValue"`.
Where the value's path answers nothing and the request's own path does, the
value's path is a mount in front of the service and the join made without it
stands.

**A worker's service binding is a request to the worker it is bound to.**
`env.CATALOG.fetch(input, init?)` — and `this.env.CATALOG.fetch`,
`c.env.CATALOG.fetch` — is an `http_out` with `meta.binding: "CATALOG"`, its path
read from `input` (a URL whose host is ignored, a `Request` built from one, or a
path) and its verb from `init`. The binding is recognised by the receiver's type
(`Fetcher`), or, with the types not installed, by its shape alone, an upper-case
property of an `env`. The worker's `wrangler.json`, `wrangler.jsonc` or
`wrangler.toml` `services: [{ binding, service, entrypoint? }]` (and
`env.<name>.services`, chosen like `vars` by `settingFiles.environment`) says
which worker the name reaches; that worker is the configured service named or
aliased so, or whose own wrangler file deploys it under that `name`. The join is
`static`, `via: "serviceBinding"`. A binding to a worker no service is, or one no
wrangler file of the caller declares, is a `service-binding-unknown` row; a
request recognised by its shape alone and declared nowhere is left alone, since
it may not be a binding at all. Service-binding RPC (`env.X.someMethod()`) is
not read.

**A verb a wrapper is handed is read at each caller.** A client that takes the
verb as an argument — `this.req('PATCH', path, body)` into `fetch(base + path, {
method })`, or `http.request(method, url)` in a browser — writes one request for
every verb it will ever send. Each caller is credited with the verb it hands in,
read the way a segment is (a literal, a `const`, an enum member, a member of an
`as const` object, a parameter's default), out through further wrappers, along
the same calls its address was followed through. A caller that hands in
something nothing can read keeps the request with its verb unread, an
`api-method-dynamic` row, and joins nothing; it used to be read as `GET`. A
parameter a caller leaves out is its default: `url(suffix = '')` called as
`url()` is the base path.

**Two APIs at one address are two entries.** Where two APIs (REST, HTTP or
WebSocket) or two load balancers of one deployment serve the same method and
path, each route is keyed with its API's name, `GET:/status@api:library-loans-api`;
a route no other API of the deployment serves keeps its plain key. A stage or a
base path already sits in the path, so two APIs mapped apart never meet here. A
request reaching such an address through a `baseUrlEnv` setting is joined to the
API whose name shares the most words with the setting's, generic words (`api`,
`url`, `lb`...) aside: `LOANS_API_URL` means `library-loans-api`. That is a
guess, drawn `heuristic` with `via: "apiName"` and a `route-api-guessed` row at
`info`; a name that settles nothing (`BRANCH_URL`) joins nothing and is an
`ambiguous-route-api` row naming the APIs (`fixtures/lambda-terraform-shared-paths`).

An API whose name is not read (a variable with no value) is keyed by its
declaration's address instead, `GET:/hours@api:aws_apigatewayv2_api.desk_hours`,
and still kept apart; its address's last word is what a setting's name is
compared with. Two listeners of one load balancer that send the same method and
path to different targets are kept apart by the listener as well,
`GET:/health@api:staff-lb@listener:HTTPS:443` (its protocol and port, or its
address where neither is read); listeners that send it to one target are one
route, since a caller reaches the same code on either port. A setting naming
such a load balancer narrows the request to its listeners' routes and is an
`ambiguous-route` row naming them. Routes are kept apart across every
deployment a repository is read from, and a route hung from another
repository's point that lands where a route of another API already is keeps
both apart the same way. A `@CallsService` annotation names a service, not one
of its APIs: where its route is served by several, the call's base URL setting,
else the service's name, chooses as above, with the same `route-api-guessed`
and `ambiguous-route-api` rows.

**A relative request needs no configuration at all.** `fetch('/api/thing')` names
no service and is rooted at no key, because it means the server the page came
from. Such a request is resolved against the routes of the service it was written
in, before any search of the others, and the edge says `via: "same-service"` with
`confidence: "static"` — a path matching a route in the same repository is one
reading of one directory rather than a guess between services. A frontend that
serves routes of its own and calls somebody else's is unaffected: where its own
service answers nothing, the search goes on exactly as before, and where nothing
anywhere answers, the row says so and names the verbs that path does answer.

**A host the configuration names is that service.** A browser request whose
address names a host outright - written at the call, or the base of the client
instance it goes through (`axios.create({ baseURL: 'https://billing.example.test' })`)
- joins the service reached at that host: its name, an alias, or one of its
`hosts`. The edge says `via: "host"` and is `static`, as `apiTarget` is, because
the code names the host and the configuration says whose it is; the request is
then no third party, and the `external_api` node drawn for the host goes. A
host only a service's own setting files name joins `heuristic`
(`fixtures/client-instance-base`). Requests between services keep reading a
host written outright as a third party.

**`document` is for the ends of a project nobody here can read.** A payment
provider, another team's service, something written in another language: there
is no repository to open and no extractor to choose, so the document is read
instead and its routes, its channels and its shapes land in the graph exactly as
a repository's would. Such a service has no `repo`, and the configuration is
refused if it has both, because source that can be read is read: the service
lives in the directory its document is in. `type` is left out, since no reader
runs.

```json
{ "name": "billing", "document": { "kind": "openapi", "path": "contracts/billing.json" } }
{ "name": "billing", "document": { "kind": "asyncapi", "path": "contracts/billing.asyncapi.json" } }
```

`kind` names the reader, and it is the only place the format is decided: an
unknown kind is refused by name, with the kinds there are. `openapi:
"contracts/billing.json"` still works and means exactly
`{ "kind": "openapi", "path": "contracts/billing.json" }`; write one or the
other, not both.

**An `asyncapi` document declares channels rather than routes.** Each operation
it sends on becomes a publisher and each one it receives becomes a handler, on the
same channel node a repository that was read lands on — so a publish in your
source and a consumer that only a document declares meet with nothing joining
them, and the contract check compares the payload as it compares any other.
Versions 2 and 3 are both read, including the fact that version 2's `publish`
means the service *receives*. `fixtures/multi-repo-asyncapi` is the worked
example.

Every node, every edge and every join into a declared service carries
`declared` confidence rather than `static`, because a declaration is somebody's
word for itself and an edge may not claim more than the weakest of its two ends.
`declared` is its own level, below `marker`: an annotation is written by
somebody who can see the code, a document by somebody who cannot see yours.
Nothing here can check a document against the running service, so `doctor`
reports how recently the document changed — against the newest commit among the
repositories that *were* read — under `document-age`, with the kind of document
named in the row rather than in the reason. That reason was spelled
`openapi-document-age` before there was a second kind of document; a project that
silenced the old spelling in `doctor.ignoreReasons` keeps it silenced, because
both spellings are recognised. That age is worked out when `doctor` runs rather
than recorded when the graph is built, because it is a question about today. `fixtures/multi-repo-declared` is the
worked example of a document that declares routes.

### Top level

| Key | Type | Default | Means |
|---|---|---|---|
| `sharedPackages` | string[] | `[]` | packages whose types are one declaration rather than two copies |
| `builtInShapes` | boolean | `true` | where a repository has not installed `rxjs`, `@nestjs/common`, `@nestjs/core`, `@nestjs/microservices` or `@nestjs/passport` (read by the server reader), or `rxjs`, `@angular/core` or `@angular/common/http` (read by the Angular reader), read a few hand-written declarations of their public surface in their place, so `ClientsModule.register` tokens, `ClientProxy` calls, passport's `AuthGuard`, Angular's decorators and `HttpClient`, and `Observable<T>` returns resolve; an installed package always wins. `false` turns them off |
| `shapes` | string[] | none | shape files of the project's own: paths or globs of `.d.ts` files, relative to this configuration, each holding `declare module '<package>' { ... }` blocks. Read in memory, never run and never written, for a package that is neither installed nor the source of a repository read here; a block wins over a reader's built-in shape of the same package. `flowatlas shapes --suggest --out <dir>` writes starters |
| `patterns` | string[] | none | pattern files of the project's own: paths or globs of `.yml` / `.yaml` files, relative to this configuration, each a list of rules that say in code what a call of an in-house wrapper is (see [Your own extraction patterns](#your-own-extraction-patterns)). Compiled into the descriptions under `adapters` and read as those are; `flowatlas patterns test` runs each rule's tests |
| `packageSources` | boolean or `"services"` | `true` | where an import of a package that is not installed is read from: `true` for the source of a configured repository, a workspace member of one, or a directory directly under the configuration whose `package.json` `name` is the package; `"services"` for configured repositories and their members alone; `false` for nowhere. Types only; an installed package always wins |
| `settingFiles.read` | boolean | `true` | whether a base address and an address waiting on the environment are completed from what the repositories' own files and the code's own fallbacks say a setting is; only addresses are kept, never a secret |
| `settingFiles.environment` | string | none | the environment read where files name several (`.env.development` and `.env.staging`, `docker-compose.prod.yml`, a worker's `env.<name>.vars`): that environment's files, and the files for none in particular; also the cluster overlay whose folder is named for it and the chart install whose values file is (P260) |
| `settingFiles.overlays` | string[] | none | the kustomization overlays to read where several build on one base (P260), folders relative to this file |
| `settingFiles.chartValues` | object | none | the values files a chart is installed with (P260), by the chart's folder relative to this file, each file relative to it too; read over the chart's own `values.yaml`, in place of what an install command gives |
| `output` | string | `.flowatlas` | where everything a build writes goes, relative to this file: the three outputs, the cache and each service's own graph under `services/`. Nothing is written into the repositories |
| `types.maxDepth` | number | `3` | how deep an anonymous shape is written out before it becomes a reference |
| `contracts.depth` | number | `3` | how far into nested shapes `flowatlas contracts` compares |
| `contracts.rules.disable` | string[] | `[]` | rules about the JSON wire this project's wire does not follow |
| `contracts.ignoreEdges` | string[] | `[]` | boundaries whose drift is deliberate, as `from\|type\|to`, for code you cannot annotate |
| `deployed.file` | string | `flowatlas.deployed.json` beside this file | the pins file `flowatlas check --env` reads and `flowatlas deployed set` writes: which ref of each service runs in each environment, relative to this file |
| `doctor.baseline` | string | `flowatlas.baseline.json` beside this file | where the accepted numbers live, relative to this file |
| `doctor.ignoreReasons` | string[] | `[]` | reasons left out of the growth check. Their rows are still printed; only the number `--strict` compares is quieter. A renamed reason's old spelling is still recognised |
| `doctor.markers.warnAsError` | boolean | `false` | fail a strict run on a redundant annotation as well as a false one |
| `doctor.publicDecorators` | string[] | `["Public", "IsPublic", "AllowAnonymous", "SkipAuth"]` | decorators that mark a handler public on purpose, so `route-unguarded` leaves it out |
| `doctor.publicRoutes` | string[] | `[]` | routes public by decision, as `METHOD /path` with `*` for any run of characters (`* /api/health`, `GET /api/public/*`) |
| `doctor.nonGateWrappers` | string[] | `["ThrottlerGuard"]` | guards that refuse nobody for who they are, so a route behind only these is still `route-unguarded` |
| `doctor.skipGuardDecorators` | object | `{}` | decorators that switch a guard off for one handler through the reflector, each mapped to the guard classes it switches off (`{"SkipTenantAuth": ["TenantAuthGuard"]}`; `[]` = every guard); a route carrying one is audited as if those guards were absent |
| `callShape.conditionalWrites` | string[] | `[]` | functions or methods of your own that change a row only in the state it is expected in (a guarded transition, a compare-and-set): a loop whose every query goes through one is a `query-in-loop` note, not a likely N+1 |
| `callShape.perItemHosts` | string[] | `[]` | hosts that take one recipient per request: a loop whose every request goes to one is a note |
| `dead.infrastructure.paths` | string[] | `[]` | routes `flowatlas dead` lists as infrastructure, spelled as `doctor.publicRoutes` spells them (`POST /inbound/*`) |
| `dead.infrastructure.decorators` | string[] | `[]` | handler or controller decorators that mark a route as infrastructure |
| `dead.infrastructure.names` | string[] | `[]` | handler or controller names (`OpsController`, `OpsController.flush`) that mark a route as infrastructure |
| `dead.infrastructure.builtIn` | boolean | `true` | `false` turns the built-in probe, webhook, callback and well-known rules off; the three lists still apply |
| `callShape.boundedCalls` | string[] | `[]` | helpers of your own that split a list into chunks, beside the built-in `chunk`, `chunks`, `batches`, `inChunks` and `splitEvery`: a loop over what one returns is set aside |
| `docs.files` | string[] | every `*.md` under this file | the Markdown files `flowatlas docs` reads for blocks tied to flows: paths or globs, relative to this configuration. Files in the output directory and `node_modules` are never read |
| `rules` | object[] | `[]` | architecture rules: who may call, write, publish to or consume what ([`rules`](#rules)) |
| `rulesSettings.failOnHeuristic` | boolean | `false` | whether a violation along a guessed edge can fail `rules --fail-on`, `doctor --strict` and `diff --fail-on-rule-break`; it is always shown |
| `mcp.tools` | `"auto"` or `"all"` | `"auto"` | which tools the MCP server lists: `auto` those the project can answer (the run-time tools once an observed file is beside the graph, `check_rules` once `rules` holds one, …; see [which tools appear when](mcp.md#which-tools-appear-when)), `all` every tool |
| `mcp.include` | string[] | `[]` | tools listed whatever they need; each then answers for itself |
| `mcp.exclude` | string[] | `[]` | tools never listed; a call of one says it is turned off. A name in either list that is no tool, or a tool in both, stops `flowatlas mcp` at start with a configuration error naming it |

**A path segment written as a closed set.** A segment whose type is a union of
string literals — `action: 'ship' | 'refund'` — is a segment that was
written down, in the type system rather than in the expression. Matching it as
a hole finds whatever route happens to have a parameter there, or a catch-all,
or nothing. It is now matched as each value as well: where every value reaches a
route the call joins to each of them, and where some do and some do not the
finding names the value nothing serves. A union of more than twelve values is a
domain rather than a choice — a currency, a locale, a status — and is read as a
hole, as is a segment typed `string`.

**Checks over the joined routes.** A build also records four findings no single
repository can see, as ordinary rows under `doctor`'s unresolved section:
`route-unguarded` (an HTTP route with no guard or middleware in front of it that
reaches stored data; a guard is read through a decorator of the project's own
that returns `applyDecorators(UseGuards(...), ...)`, one level deep; a route
whose reader says it did not read the middleware installed for a whole prefix is
listed at `info` instead, since a guard that may be there is not a hole),
`route-guard-skipped` (the same route, except that a decorator named under
`doctor.skipGuardDecorators` switches the guard off for it — somebody decided
this in writing on the handler, so it is listed at `info` and does not ask to be
written down a second time under `doctor.publicRoutes`), `route-checked-in-body`
(the same route again, except that its own code throws a 401 or a 403 — it
checks who is asking in the body rather than in a guard; listed at `info` with
the throw it rests on, since nothing here can tell whether the check runs before
the data is read; the exception may come from a helper, see below),
`route-public-declared` and `marker-reason-missing` (a route marked
`@flowatlas-public`, with and without its reason, both at `info`), `route-shadowed` (a
route a worker answers before the
application, whose guards then never run) and `route-wildcard-only` (a request
only a catch-all route answers). Accept them into the baseline once reviewed;
`--strict` then fails only on new ones.

**Public on purpose, read rather than configured.** A NestJS decorator that
sets a flag to `true` — `@Public()` as `SetMetadata(IS_PUBLIC_KEY, true)`,
written out, behind a function of the project's own, or inside
`applyDecorators(...)` with other decorators, on the handler or on its class —
switches off each guard in front of the route that reads the same key, the way
the framework does. Its name or its key says which decision it is: `Public`,
`AllowAnonymous`, `isPublic` and their like mean open on purpose, so the route
has no row at all; any other opt-out word (`SkipTenantCheck`) switches one guard
off and the route is `route-guard-skipped`. A flag whose words say neither
(`@StrictAuth()`) is not an opt-out, whatever reads it. `doctor.publicDecorators`
and `doctor.skipGuardDecorators` still say the same for decorators this cannot
follow (`fixtures/nest-route-access`).

**Accepting routes public by decision together.** `flowatlas accept` takes a
rule as well as a single gap: `--path` with a route pattern accepts a route
finding on every route it names, and `--file` takes a glob.

```sh
flowatlas accept route-unguarded --service catalog --path 'GET /api/public/*' --dry-run
flowatlas accept route-unguarded --service catalog --path 'GET /api/public/*' \
  --note 'the public catalogue is open by design'
```

A rule goes on accepting rows nobody has looked at, so one with `--path` or a
file glob needs `--note`, and `--dry-run` lists what it would take before
anything is written. `doctor` leaves the rows out of its counts; the page's
*Not joined* tab lists them under Accepted, by that rule, and every row there
has a `⋯` menu that copies the command for that one route, or for the routes
beside it with `--dry-run`. `accepted.json` is written as version 2,
which an older `flowatlas` refuses rather than reading the rule as wider than
it is.

**`/** @flowatlas-auth <how> */`.** Some handlers refuse a request in their own
body — a signed header resolved inside the method, a service token checked by
hand — and no guard sits in front of them because none should. Static reading
cannot see any of that. The annotation on the handler says so in one line, and
the route audit then says nothing about it. Like every marker it is
unverifiable: it is worth what whoever wrote it is worth, and it is the same
bargain `@flowatlas-calls` offers for an address built at run time.

**A check thrown through a helper.** A handler often refuses a request with
`if (!check.ok) throw toHttpError(check)`, where `toHttpError` picks the
exception from a table at run time. The throw is read through the helper - a
function of the service, a method of the class (`this.reject(...)`), a member
of an object of functions (`errors.toHttp(...)`), or a method of an injected
class written in the project - and through `const e = toHttpError(check);
throw e;` and `throw await ...`. What the helper returns is read off every
`return`, through a ternary and a `switch`: `new X(...)`, `new TABLE[key](...)`,
`new (TABLE.get(key) ?? Fallback)(...)` for an object or `Map` of exception
classes written as a `const`, `TABLE[key]` for one of exceptions already built,
and one more helper it calls (two levels in all). The failure is named after
the helper, `exception: 'toHttpError'`, with `via: 'helper'` and
`chosenFrom: [{exception, status}]`, every class the table can give, each
answered through the exception filters in front of the route; `status` is set
only when every choice agrees. Where any of those cannot be read - the helper
returns what it was handed, or builds a class from a parameter - the failure is
kept with no choices, and is `family: 'auth'` when the `if` above the throw
tests what a check of who is asking answered: a call whose name, receiver or
receiver's type has a word such as `auth`, `verify`, `permission`, `access`,
`role`, `member`, `session`, `token` or `signature` in it (`!check.ok`,
`check.denied`, `!(await this.auth.verify(req)).ok`). A route with no guard is
`route-checked-in-body` when any choice is a 401 or a 403, or the failure is
`family: 'auth'`; a helper whose table gives a 404 and a 410 is not a check
(`fixtures/nest-check-through-helper`).

**`/** @flowatlas-public <why> */`.** A route open on purpose, said on the
handler or on its controller class, the handler's own first. The route audit
gives it no `route-unguarded` row, and lists it at `info` as
`route-public-declared` with the reason given, so the decision stays visible;
a marker with no reason is taken as public all the same and listed as
`marker-reason-missing`. Nothing else is ever read as public: not the verb, not
the path, not a controller's name, not a handler that takes no user. A `GET
/catalogue/items` with no guard and no marker is `route-unguarded`.

**A channel addressed as a template.** `` `ticket:${id}:${verb}` `` has two
holes and they are not the same kind of thing. The id is genuinely unknowable
and reads as `*`. The event usually is not, and is read two ways, neither of
which needs anything written down:

```ts
type Verb = 'opened' | 'on-hold' | 'closed';

// Read from the type, wherever the value is written — a local, a function's
// return, or the call put straight into the template.
const verb: Verb = this.registry.verbFor(type);

// Or folded, when the value derives from a union by plain string work:
// slice, substring, case changes, trim, replace, and `+`.
const verb = type.slice('TICKET_'.length).toLowerCase().replace(/_/g, '-');
```

Either way the address becomes one channel per value. Nothing is folded half
way: a step that cannot be applied exactly puts the hole back, because
inventing a channel nobody publishes to is worse than admitting a wildcard.

**There is no annotation for this, on purpose.** One was built and removed
before it shipped. Every hole it could have named can be named in the type
instead — including with a cast at the use site, for code you do not own — and
the type is checked, renames with its members, narrows the value for the rest
of the function, and cannot drift from the code because it *is* the code. A
comment does none of that and can be silently wrong. Where neither the type nor
folding can settle a hole, the channel reads `*` and says so.

**Rules the contract check applies on top of the wire.** `optional-accepts-null`
(a field a receiving validator marks `@IsOptional` reads `null` too),
`null-for-optional` (a `null` sent where an unvalidated receiver declares the
field optional is a warning, not an error) and `whitelist-strip` (a field sent to
a route whose `ValidationPipe` whitelists, and which the receiving class does not
declare or decorate: it is removed before the handler runs). A
request made from a browser service method nothing calls is reported as a
warning rather than an error, and says so.

**What a strip can lose.** A `whitelist-strip` row carries an `impact`, worked
out from the graph rather than from the field's name: `stored` when the
receiving handler writes a document that declares the field, `unread` when it
writes something and no document of what it writes could be read, `unknown`
when the documents were read and none of them declares it, and `none` when it
reaches no write at all. A handler that persists nothing cannot lose data by
dropping a field, so those rows are `info` and the command counts them on one
line instead of listing them; the others are warnings, with `stored` first. Every row is in
`--format json` whatever the command printed.

**What a call sends against what its type permits.** A declared parameter type
says what a call is *permitted* to send. Where an object written in the source
says which keys it writes — at the call site, in a `const` a line above it, or
handed in by the callers of the method that makes the request — those keys are
what is compared, and a key the type permits but nothing writes is not a
finding. Several callers each writing an object answer with their keys
together, since a key none of them writes is a key nothing sends; a message
about them says "sent by some of the calls" rather than "always sent", because
none of those keys is on every request. A spread of a wider object into a literal really does put its keys on
the wire and stays one. Where there is no such object, the declared type is all
there is, and the sentence says "permits" rather than "sends". The party in
`contracts.json` carries `writes` when the keys were read.

`contracts.json` is at format version 5 (`contractsFormatVersion`): a party may
carry `writes`, a finding may carry `impact`, a request-direction message
distinguishes what a call sends from what its type permits, an `impact` may read
`unread` as well as the three words version 2 knew, a party may carry
`declaredBy`, naming the document an end nobody here could read was taken from
(version 4), and `claimed`, when the type at that end is only what a cast in the
handler says, so a finding against it is never more than a warning (version 5).
With `observe --shapes` beside the graph, a finding may carry `seenIn` and `of`
(the bodies that carried the field, of those that could have) and the file a
`traffic` section, without a version of their own: traffic alone
never fails a contract.

**What is not compared, and says so.** A boundary nothing can compare is listed
under `unchecked` with the reason, never counted as agreeing. A request for a
procedure is compared like any request (P247): what the call hands - the type
the client declares for its argument, or the argument's own where the client is
typed `any`, with the keys a literal writes - against the input the procedure
declares (the schema's input side, through the validation library's inference),
and what the procedure answers against what the call reads back, where the call
returns it. An end with nothing to compare is a row: a procedure that declares
no input (`procedure-input-undeclared`), an input schema whose type does not
resolve here because its library is not installed (`procedure-input-unread`),
an input handed later - `useMutation()`, `mutationOptions()` - or not written
(`procedure-input-not-at-call`), an answer handed to a hook or a query's options
(`procedure-output-inferred`), and a client typed `any` (`no-type-on-sender`,
`no-type-on-receiver`, with a hint for a client of a tree). A plain request to a
procedure's REST route is compared with the input the route assembles from it
(P256, below); a query it writes in a way nothing reads is
`procedure-input-by-name` with detail `query`. A handler that takes
a `string` and parses it on the next line is another, `body-already-serialised`,
because that is where the shape was lost rather than an end that disagrees about
it.

### `rules`

Who may call, write, publish to or consume what, written down so a build fails
when it stops being true. Each rule has a `name` (kebab-case and unique: the key
a baseline and an accept use), a `severity` (`error` unless it says `warning`
or `info`), an optional `note` (why; printed with every violation) and exactly
one of four shapes:

```json
{
  "rules": [
    { "name": "frontends-reach-only-edge", "note": "the browser talks to the gateway",
      "tags": { "source": "frontend", "mayReach": ["edge"] } },
    { "name": "web-not-billing",
      "forbid": { "from": { "service": "web" }, "to": { "service": "billing" } } },
    { "name": "only-orders-writes-orders",
      "only": { "from": { "service": "orders" }, "to": { "table": "orders" }, "op": "write" } },
    { "name": "only-billing-consumes-invoices",
      "only": { "from": { "service": "billing" }, "to": { "channel": "invoice.*" }, "via": ["consumes"] } },
    { "name": "order-created-keeps-a-consumer",
      "reachable": { "from": { "channel": "order.created" }, "to": { "service": "billing" }, "must": true } }
  ]
}
```

| Shape | Says | Broken by |
|---|---|---|
| `forbid: { from, to, via?, reach? }` | `from` must not reach `to` | `reach: "direct"` (default): one hop from a node `from` selects to one `to` selects. `"transitive"`: any path forward, through calls and channels, reported where it first enters `to` |
| `only: { from, to, via?, op?, reach? }` | nothing outside `from` may reach `to` | `reach: "direct"` (default): a hop into `to` from a node `from` does not select. `"transitive"`: any path into `to` that does not go through `from` (below); `op` (`read`, `write`, `delete`) narrows a table's queries, the last hop's in a path |
| `tags: { source, mayReach, via? }` | a service tagged `source` may join only services carrying one of `mayReach` (`*` any) | a hop from such a service into one carrying none of them; a consume joins the services that publish onto the channel, a publish joins nobody in particular |
| `reachable: { from, to, must }` | with `must: true`, a path from `from` to `to` must exist | `true`: no path any more (one violation, with no hop to point at). `false`: every path that does |

A **transitive `only`** reads "only `billing` may reach the `payments` table,
even through other services". Whatever `from` reaches acts for it: a workflow
`billing` starts, a route it calls, a handler of a channel it publishes onto
writing `payments` is `billing`'s write, and a path that goes through `from` is
`from`'s own. A violation is a path into `to` that does not: it is walked back
from `to` through what acts for `from`, and starts at the nearest node that
`from` neither selects nor reaches. That node is the violation's `from` and its
`at` (the call, request, publish, start or query that took the path), its `via`
is the kind of the path's first hop between services, its `path` every hop from
there to `to`, and its confidence the weakest of them, as for a transitive
`forbid`. What is in front of that node is not reported again: a gateway route in
front of a service that breaks the rule is the service's violation, not the
gateway's. A one-hop path reads as a direct `only` does. To leave channels out
of what acts for `from`, name a `via` without `emits` and `consumes`. A walk
stops at 5,000 nodes and the rule says so (`walkCut`); when that happens while
working out what `from` reaches, the rule reports nothing, since every node past
the cut would look like a violation.

A **selector** is `{ service?, tag?, entry?, table?, channel?, route?, type? }`,
every key optional and all of them ANDed; `*` (and `**`) is any run of
characters. `service` and `tag` select the nodes of a service (a channel belongs
to none), `entry` a way in by id or label, `table` and `channel` by name,
`route` an HTTP way in as `METHOD /path` (`GET /orders/*`, matched as
`doctor.publicRoutes` is), `type` a node type (`ui_api_call`, `method`, …).

The **edges** a rule can name in `via`: `http_calls` (one service's request to
another), `hits` (a browser's request), `emits`, `consumes`, `queries` (a
table read or write), `triggers` (a workflow or a function started by name) and
`calls` (inside one service, only when named). Without `via` a rule reads every
kind but `calls`, and a hop inside one service - a service reading its own
table - is read only when the rule's `to` names a `table` or its `via` names the
hop's kind. A consume is read the way a dependency runs: the handler depends on
the channel.

A rule that fails this schema - two shapes, none, an unknown key, a name that
is not kebab-case, a name used twice - is refused when the configuration is
read, naming the rule (`rule-invalid`).

### `adapters`

| Key | Type | Default | Means |
|---|---|---|---|
| `auto` | boolean | `true` | detect which adapters apply from each repository's manifest |
| `force` | object | `{}` | use these adapters regardless of what was detected |
| `db.localBaseClasses` | (string \| object)[] | `[]` | classes of your own that behave like a repository, so calls through them are data access — including classes a workspace package of yours declares. An entry may be `{ "name": "BaseRepository", "tableProperty": "collectionName" }` to say which property each class extending it sets to its table |
| `db.tables` | object[] | `[]` | functions your data access goes through that name their table at the call — `insert('orders', row)` from a data kit of your own, installed or not: `{ "name", "package"?, "factory"?, "clientType"?, "table": argIndex \| "name", "op"?: "read" \| "write" \| "delete" }`; with `factory`, `name` is a method of the client that factory returns, and `clientType` the type a client handed in is declared as (see [Tables named in configuration](#tables-named-in-configuration)) |
| `frontend.localClientClasses` | string[] | `[]` | classes of your own that make HTTP requests, so `get`/`post`/… called on them are requests |
| `http.clients` | object[] | `[]` | an HTTP client of your own, described by the call it is - `{ "receiverType" \| "factory" \| "function", "method"?, "module"?, "verb"? \| "verbAt"?, "url", "body"?, "where"? }`, `url`, `body` and `verbAt` as locators; the verb is the method's own name (`post`) when neither `verb` nor `verbAt` is said. Read by the server reader's request pass and by both browser readers; patterns of kind `http-request` compile into it (see [Your own extraction patterns](#your-own-extraction-patterns)) |
| `broker.custom` | object[] | `[]` | an in-house message bus, described so its publishers and handlers are found |
| `starters` | object[] | `[]` | a helper of your own that starts a workflow or invokes a function by its deployed name, described so the start is joined to what it starts (see [Code that starts a workflow or a function](#code-that-starts-a-workflow-or-a-function)) |
| `entry.registries` | object[] | `[]` | a table of handlers you keep yourself, described so each registration is a way in |
| `entry.http` | object[] | `[]` | an HTTP framework nothing here ships an adapter for, described so its routes are read |
| `entry.procedures` | object[] | `[]` | a framework whose ways in are the keys of a tree of object literals, described so each one is read |
| `entry.request` | object | — | your own helpers that build every answer or parse every body, read beside every framework's own places (see [An answer built by a helper](#an-answer-built-by-a-helper)) |
| `infra.modules` | object[] | `[]` | a Terraform module whose source is not in the repository, described so the functions and routes declared through it are read |

**Detection reads the workspace, not only the leaf manifest.** A service that is
a package inside a workspace is asked what it can import, and the answer is
every dependency declared along the workspace chain it belongs to: the
directory's own `package.json`, the manifest of any directory above it that
lists it as a member — through `workspaces` or `pnpm-workspace.yaml` — and,
where the directory handed over is itself a workspace root, the manifests of the
packages inside it, whose sources are read as part of it. A dependency declared
at the root of a workspace is available to a package inside it; that is the fact
being followed. Without it, a leaf manifest that is a name, a version and an
exports map — the normal shape of a workspace member — switched every adapter
off, and the repository came back with no routes, no channels and no data layer,
which reads exactly like a repository that has none.

The chain also takes in the members the service itself declares, transitively,
because those are the directories whose sources are read as part of it. A monorepo
where the application declares a library and the library declares the framework is
the ordinary shape, and reading it any other way switches an adapter off while the
code it would have read is in the graph: an application that depends on its own
`@acme/trpc` package, which is where `@trpc/server` is declared, has every one of
its procedures in that package. Only what the service reaches is taken in — a
workspace has hundreds of members and a service declares a dozen, and folding in
the rest would make every service look like every framework anybody in the
repository uses. A member is followed through its runtime dependency sections
only, never its devDependencies, for the reason given under
[`build`](#flowatlas-build-dir).

An adapter switched on this way, through a member rather than by the service's
own manifest, is named on `build`'s `found at arm's length` line with the member
it came through. That is usually right — the member's code is read as part of the
service — and is sometimes a package that only imports a framework's types, which
this rule cannot tell apart, so the line is there for you to judge. What a
service *is* is still asked of its own manifest: a Next.js application that
imports a package of Nest DTOs is not told to set a Nest bootstrap
(`fixtures/next-sibling-nest-types`).

The type of a service is a narrower question and is answered narrowly: `link`
guesses it from the repository's own manifest, and only falls back to the
workspace when its own says nothing that gives a framework away. A package that
declares Express is an Express service whatever the monorepo around it keeps in
its tooling.

**`force` is said once, for the whole project, and cannot be said per service.**
A slot it names replaces the detected list in every repository, so a project
that forces one entry adapter for one service must name the adapters of all its
other services beside it. That is a real limitation and it is written here
rather than worked around, because the thing that used to make people reach for
it is gone: a described HTTP framework now detects itself where its `packages`
say it lives, which was the one case where a whole project had to be overridden
for the sake of a single repository. What is left for `force` is what it was
named for — detection guessed wrong for this project — and that answer is the
same for every repository in it. A per-service `force` would have to be
honoured by all three readers to mean anything, and a configuration key that
two of them ignore is worse than a documented limitation; when it is added it
belongs where the readers are chosen, so that each of them is handed a
configuration already narrowed to the service it is reading, rather than in
three copies of the same merge.

**A data layer of your own, in a package of your own.** A monorepo usually keeps
its database behind a workspace package — `@acme/db` — and what that package
hands on decides whether anything needs saying. A package that configures a
library's client and re-exports it hands on the library's own types, so the
library's descriptor is found and every query is read with no configuration at
all (`fixtures/nest-prisma-wrapper`). A package that declares classes of its own
around a driver — a `Database` with `findOrders`, an `OrdersRepository` — is a
data layer nothing here describes, and every call through it is a row until it
is named (`fixtures/nest-workspace-wrapper`).

The rows say which package. A workspace resolves its own packages through
links, so the checker reaches the wrapper's source directly and reads its types
as the project's; a row about one used to call it "declared in this repository"
of a service that declares nothing of the kind. Now `db-receiver-name-only`
names the workspace package the receiver's type is declared in, and
`db-layer-unread` names the package beside the class. Naming the class there, or
any class it extends, is the whole fix:

```jsonc
{
  "adapters": {
    "db": { "localBaseClasses": ["Database", "OrdersRepository"] }
  }
}
```

Each call through a named class becomes a `db_query` whose `package` is
`local:<class>`, and its operation is read off the method name the way a
repository base's is (`find*` reads, `save*` writes). The table is named where
the class carries it as a type argument — `OrdersRepository extends
Repo<Order>` — and is otherwise reported as a table the call does not name.

A base whose classes state their table in a property is written with that
property, and the table is then read from the class each call is made through:

```jsonc
{
  "adapters": {
    "db": {
      "localBaseClasses": [{ "name": "BaseRepository", "tableProperty": "collectionName" }]
    }
  }
}
```

`class ProductRepository extends BaseRepository<Product> { protected readonly
collectionName = 'products'; }` makes every call through a `ProductRepository`
a query on `products`, whether the value is a literal or a constant; the class
itself first, then each class it extends. The stated name wins over the type
argument. Inside such a class, a query made through `this` whose chain names no
collection is on the class's own table: `const c = await this.coll();
c.find(…)` in `ProductRepository` is a query on `products`. A query written inside
the base itself runs for every class that extends it, so it has no one table; it
is an `info` row saying so, and each call through a subclass carries that
subclass's table. A base named as a plain string
keeps working as before; where its own queries say which property its classes
set (below), that property is read, and otherwise a query through it whose table
is not read carries a row naming `tableProperty` as the key that would read it
(`fixtures/nest-mongo-tables`).

**Tables set one step away, read without configuration (P88).** Three shapes
are read with no `adapters.db` entry at all:

- *A field each class sets for its base.* A query in an abstract base, or one
  something extends, that hands `this.<key>` to the library's own table
  argument - `db.collection(this.collectionName)`, `knex(this.table)` - says
  where its classes name their table, exactly as `tableProperty` would. Every
  call through a class under it is read on the table that class sets; the
  query in the base keeps its `info` row; a class that sets the field to
  something unreadable gets a `dynamic-table-name` row naming that class. A
  configured `tableProperty` still wins. The query carries
  `meta.tableFrom: "inferred-property"`, and is `heuristic` when the field is
  not `readonly`.
- *A helper that hands out the collection.* `this.coll().find()` and
  `this.collection.find()`, where `coll()` or the getter `collection` of the
  same class (or a base) returns one expression - `db.collection(COMMENTS)` -
  is read through that expression, one level deep (`tableFrom: "helper"`). A
  helper whose table is its own parameter, `coll(name)`, stays a gap.
- *An entity class handed to a manager.* On TypeORM's `EntityManager` and
  `DataSource`, `find(Rating, ...)`, `save(Badge, ...)`,
  `createQueryBuilder(Reviewer, 'r')` and a builder's `from(Rating, 'r')` name
  the table by the class: what `@Entity('ratings')` or
  `@Entity({ name: 'ratings' })` states, else the class name
  (`source: "entity-arg"`). `getRepository(Rating)` hands out a
  `Repository<Rating>`, read as one.

The type-argument path reads `@Entity(...)` the same way, so a
`Repository<Rating>` over `@Entity('ratings')` is on `ratings`, not `Rating`:
one table, one name, whichever call reaches it. A sub-query, a builder with no
entity, and SQL built at run time stay `dynamic-table-name`.

A call that reads as data only by the receiver's name -
`this.searchRepository.lookup(term)` - and that the graph already draws as a
`static` call into a method of the service's own is no longer a
`db-receiver-name-only` row: the queries are read where that method writes
them. `flowatlas stats` counts these as `receivers explained by a drawn call`
(`fixtures/tables-set-elsewhere`).

#### Tables named in configuration

A data access that goes through a package of your own nobody installed - a
shared data kit's `insert('orders', row)` - has no type to resolve and no
library to describe it, so the Map shows no data boxes. Name its functions once
under `adapters.db.tables` and every call to one is a `db_query` on the table
its argument names (P37):

```jsonc
{
  "adapters": {
    "db": {
      "tables": [
        // `findOne(MEMBERS, { memberId })`: the table is argument 0
        { "name": "findOne", "package": "@acme/data-kit", "table": 0, "op": "read" },
        { "name": "insert", "package": "@acme/data-kit", "table": 0, "op": "write" },
        // a helper of this repository that always writes one table
        { "name": "auditLog", "table": "audit_events", "op": "write" }
      ]
    }
  }
}
```

A function with a `package` is matched by the import in the calling file - by
name, under any local name, or on a namespace or default import of the package,
a default import called itself when `name` is `"default"`, and any of these
through a barrel of the repository's that re-exports it from the package
- so nothing has to be installed, and a local of the same name that shadows the
import is not it; one without is matched by a declaration of that name in the
repository. The table is the string at argument `table`, written in place or
through a constant, or `table` itself when it is a name. The query is recorded
with `source: "configured"` and `declared` confidence; a table the argument
does not name as a string keeps the query and gets a `dynamic-table-name` row
(`fixtures/data-kit-tables`).

Where the kit hands out a client and the table is an argument of its methods -
`const db = createClient(); db.insert('orders', row)` - name the factory on the
row and the method as `name` (P39):

```jsonc
{ "factory": "createClient", "package": "@acme/data-kit", "name": "insert", "table": 0, "op": "write" }
```

A call is matched when its receiver is what that factory's call returned: the
call itself (`createClient().insert(…)`), awaited or not, or a variable or class
field initialised with it, followed a few names back. The factory is matched by
the import as above; an object of the repository's own with a method of the same
name is not the client.

A client handed in rather than made there - a function's parameter, a
constructor's injected field, a field assigned elsewhere - is followed by its
declared type (P44): `ReturnType<typeof createClient>` (also behind `Awaited<…>`,
in a union with `undefined`, or through a type alias of the repository's), `typeof
db` of a client the factory made, or the type the package names its client by,
given as `clientType` on the row:

```jsonc
{ "factory": "createClient", "clientType": "DataClient", "package": "@acme/data-kit", "name": "insert", "table": 0, "op": "write" }
```

The `clientType` is matched written plainly or through a namespace import
(`kit.DataClient`) or a default import. Without one, a parameter typed by a named interface is the
client when the factory resolves - installed, or the repository's own - and is
declared to return that same type (P49): `ledger: Ledger` where
`openLedger(): Ledger`. A type nothing resolves is no evidence either way.
A parameter typed as anything else is not the client, whatever its methods are
called.

Two things a wrapper can hide are not configuration, and no key reaches them.
The library has to be among the service's dependencies — directly or along the
workspace chain above — for its adapter to be detected at all; a service that
depends on the wrapper and never on the library gets none, which `force` can
override for the whole project. And a generated client has to have been
generated: a repository installed without running its scripts has no Prisma
client declaration anywhere, and every call on it is reported as a receiver
whose type could not be resolved.

**A data layer whose library is not installed.** Without `node_modules` the
checker cannot say what a receiver is, and the data layer used to vanish with it.
The source still says most of it: an annotation names the type and the import
beside it names the package — `db: Kysely<DB>` with `Kysely` from `kysely` — and
a model class of the repository names its base, `Document extends Model` with
`Model` from `sequelize-typescript`, and its table, in `@Table({ tableName })`.
Those are read where a resolved type produced nothing, for a library something
here describes, and every query read that way is `heuristic` rather than
`static`, because it rests on what the author wrote rather than on what a
compiler checked (`fixtures/db-not-installed`). The same repository installed
reads the same tables through the checker at `static`.

**A client class of your own.** A class wrapping `fetch` behind `get` and `post`,
exported as one instance every screen imports, is the ordinary way to write a
front end, and there is no package for a description to point at. The reader
works it out where it can: a class is a client when one of its own verb-named
members can be followed to `fetch` or to an `axios` value, directly or through
another member of the same class. That is evidence and not a name — a store with
`get` and `delete` reaches nothing and is not read as a client.

Where the chain leaves the class, recognition stops: a transport in a helper
module, a base class whose source is not here, a client handed to the
constructor, dependencies that are not installed. Name the class — or any class
it extends — under `frontend.localClientClasses` and nothing more is asked; every
verb it declares is then a request, and a class that declares none of its own
answers to all seven. Requests carry `client` set to the class name and
`localClient` set to `recognised` or `declared`, so a graph says which of the two
happened.

Where a verb is called on a class of yours that could not be read as a client
*and* the call writes an address — a path with a leading slash, or a URL — one
row per site says so and names the class. Where the address could not be read
either, nothing is said: naming the client would only buy a row about an address
built at run time.

```jsonc
{
  "adapters": {
    "frontend": { "localClientClasses": ["ApiClient"] }
  }
}
```

**A client instance's base (P239).** Most front ends write every request through
an instance made once: `axios.create({ baseURL })`, `ofetch.create({ baseURL })`
or `$fetch.create(…)`, `ky.create({ prefixUrl })` or `ky.extend(…)`. The base is
read where the instance is made and put in front of the address the call writes,
so `ordersApi.get('/items')` under `baseURL: import.meta.env.VITE_ORDERS_URL` is
recorded as `GET ${VITE_ORDERS_URL}/items` and joins through `apiTarget` or
`baseUrlEnv`, `static`, instead of by its route alone. This holds in React,
Next.js client code, Vue, Nuxt and Svelte alike:

- **The base** is read as any base is: a literal, a template, a setting
  (`import.meta.env.VITE_API`, `process.env.NEXT_PUBLIC_API`,
  `useRuntimeConfig().public.apiBase`), a constant from another module, a host.
- **The instance** is followed to where it is made: a `const`, exported and
  imported (named, default, re-exported), a key of an object, a class field, a
  function of yours that makes one with the base handed in (`createApi(base)`),
  an instance made from another (which keeps the base it does not write again).
  It is told apart by the import its factory is called on, so a clone with
  nothing installed reads it too.
- **`api.defaults.baseURL = …`** set anywhere in the repository wins over the
  options the instance was made with; `axios.defaults.baseURL` applies to calls
  on `axios` itself.
- **The calls:** the verbs (`api.get(url)`), the instance called as a function
  (`api(url, { method })`, ofetch's `api.raw(url)`), and ky on the module and on
  an instance, with its body under `json`.
- **Which base wins.** A base the call writes in its own options (`{ baseURL }`)
  wins; an address with a host or a setting of its own is not under any base.
- **A class of yours holding an instance** in a field and wrapping its verbs
  takes that instance's base, where it keeps none of its own.

An Angular interceptor that puts a base in front of every request,
`req.clone({ url: environment.apiUrl + req.url })` or the same as a template, is
read the same way, for every request of the framework's client (not `fetch`).
The interceptor is a class's `intercept` or a function (`HttpInterceptorFn`),
registered with `withInterceptors([...])` or `useClass` under
`HTTP_INTERCEPTORS`; such a request carries `baseFrom: "interceptor"`. A guard
about whether the address is already absolute (`req.url.startsWith('http')`)
changes nothing.

A base that cannot be read - written and not readable, options handed in from
somewhere unread, two `defaults` assignments that disagree, an interceptor whose
rewrite depends on anything else, two interceptors rewriting the address - is
one row, `api-client-base-unread`, at the line that writes it. Its requests keep
the path each call writes and join by their route alone, as before. An instance
handed in from outside (a parameter, `this.$axios`) has nothing to read and is
not mentioned. `fixtures/client-instance-base` shows each case against two
services serving the same routes.

**A function run before every request (P244).** The base is often set one step
after the instance is made, in a function the client runs before each request.
Each is read where it is written and put into every request through that
instance, which then carries `baseFrom: "interceptor"`:

- **axios request interceptors**, `api.interceptors.request.use(fn)` on an
  instance or on `axios` itself (whose interceptors are its own: an instance
  has none of the module's). `fn` is written in place or named, and may write
  `config.baseURL = X`, answer `{ ...config, baseURL: X }`, call
  `Object.assign(config, { baseURL: X })`, or rewrite the address,
  `config.url = X + config.url` or the same as a template.
- **ofetch and `$fetch` `onRequest` hooks** among the options an instance is
  made with (a method, a property or a list of them): `options.baseURL = X`
  with `{ options }` destructured or `ctx.options`, and `ctx.request = X +
  ctx.request`. An instance made from another keeps its parent's hook unless
  it writes one of its own.
- **ky `hooks.beforeRequest`** answering a new `Request` at an address built
  from the old one's path: `` new Request(`${X}${new URL(request.url).pathname}`, request) ``.
  The path keeps the `prefixUrl` it was made under; the host is the new one.

How it composes with the base the instance or the call already gives: setting
the base outright wins over the call's own option too (it runs after the call's
options are merged in); `config.baseURL ??= X`, `||= X`, `config.baseURL ?? X`
or a guard `if (!config.baseURL)` sets it only where none is set; a rewrite of
the address goes under whatever base the client then applies. A guard about
whether the address is already absolute changes nothing, as for Angular. A
function that only sets headers changes nothing and says nothing.

A rewrite that cannot be read is `api-client-base-unread` at the line that
writes it, and the requests keep the base the instance is made with: a base
chosen between two values by a branch (`isAdmin ? A : B`) is a row, not a pick,
and so is a rewrite behind any other condition, a base that cannot be read, an
address rewritten in a shape that is not a base in front of it, and two
functions that set different bases (which runs last is not read).

**axios handed one config object (P244).** `api({ url, method, data })`,
`axios({ ... })`, `axios.request({ ... })` and `api.request({ ... })` are read
as the other spellings: the address is `url`, the verb `method` (`GET` where
none is written), the body `data`, and a `baseURL` beside them is the call's own
base. Only an object written in place is read.

**A request between services to a host a service is reached at (P244).** A
server's request with a literal host - `fetch('https://orders.internal/items')`
- joins the service the configuration says is reached there (its name, an
alias, `services[].hosts`, or a name only the project's own network resolves,
such as `orders.default.svc.cluster.local`), `static`, `via: host`, and the
`external_api` node the reader drew for that host is dropped where nothing else
calls it. A host only the services' own setting files name joins `heuristic`.
A host no service is reached at stays `external`, as before.
`fixtures/client-interceptor-base` shows each case.

**A hook written on one call (P250).** `useFetch(url, { onRequest })`,
`useLazyFetch`, `$fetch(url, { onRequest })`, an ofetch instance called with
one, and a ky call with `hooks: { beforeRequest: [...] }` run that hook for
that request alone. It is read as an instance's is and composed with the
instance's: ofetch's call options replace the instance's `onRequest`, ky runs
the call's after the instance's (two that set different bases are a row). The
request carries `baseFrom: "call-hook"`; an unread one is
`api-client-base-unread` at the hook, worded for the one call.

**ky hooks that build the address another way (P250).** Besides the template
spelling, two more are read as a new origin in front of the old path:
`new Request(request.url.replace(location.origin, X), request)` (also
`window.`, `globalThis.`, `self.` `location.origin`, or the request's own
`new URL(request.url).origin`), and `new Request(new URL(<path>, X), request)`
where `<path>` is the request's own `pathname` (with `search` after it). The
page's origin is in front only of a request relative to the page, so the first
spelling leaves an instance whose `prefixUrl` names a host or a setting alone.
`new URL(path, X)` drops the path of a literal `X`, as the platform does. A
name the hook gives the request's address (`const url = new URL(request.url)`)
is read through. A `.replace` of anything but an origin is a row.

**Where a server listens (P250).** A request to a port on this machine -
`http://localhost:3001/orders`, `127.0.0.1`, `0.0.0.0`, `[::1]` - reaches the
service listening on that port, and the code that starts each server usually
says which that is. It is read for every server the tool reads and kept on the
service's repository node as `meta.listen: [{ port, file, line, setting?, default? }]`:

| Server | Read |
|---|---|
| express, koa, fastify, NestJS, Node's own | `<server>.listen(3001)`, `listen({ port })`, `http.createServer(app).listen(port)`, through constants |
| Hono | `serve({ fetch, port })` from `@hono/node-server` (3000 where no port is written, its default), `Bun.serve({ port })` (3000), `Deno.serve({ port }, handler)` (8000), `export default { port, fetch }` |
| GraphQL servers | `startStandaloneServer` (4000 by default) and `.listen` (P245) |
| Nuxt, Nitro | `devServer: { port }` in `nuxt.config.*`, `--port` / `-p` on a `nuxi` / `nuxt` / `nitro` `dev` / `preview` / `start` script |
| Next | `-p` / `--port` on a `next dev` / `next start` script |

A port is a number, a constant, or the number a setting falls back to
(`process.env.PORT ?? 3001`, `Number(process.env.PORT) || 3001`,
`parseInt(...)`, `config.get('PORT', 3001)`); a setting with no fallback is the
setting's value, which an example environment file may give (P77). No
framework's own default dev port is assumed.

A request with a local host and a port is joined by, in order: a host the
configuration names (`services[].hosts`, a name, an alias), `static`; else the
services whose code listens on the port and those whose setting files place
them at `localhost:<port>` (a `PORT=` in an example environment file, a
published container port, a worker's `dev.port`), which together must be one.
The join is `via: host` with `meta.listensAt` (`src/app.ts:16`, with the
setting where the port is a fallback), `static` where the code writes the port
as a number and `heuristic` where it is a fallback, a library's default or a
setting file's value. Two services or more is the row `local-port-shared`
naming each and where it listens, and the request is not joined (counted as
`ambiguous` for a server's request). The third party a reader drew for the host
is dropped either way. The same lookup places a gateway's subgraph (P245), a
procedure client's link (P242), and a browser's and a server's request alike.
`fixtures/listen-port-joins` shows each case.

**Every way a port is decided (P254).** The port is read wherever the
repository decides it, not only on the line that starts the server:

| Where | Read |
|---|---|
| A front end's dev and preview server | `server.port` and `preview.port` in `vite.config.*` (SvelteKit, Remix, React Router, Vue, React and any other Vite front end), `--port` on a `vite`, `vite dev`, `vite preview`, `svelte-kit dev`, `remix vite:dev`, `react-router dev` script; Astro's `server.port` and `astro dev --port`; Angular's `serve` target `port` in `angular.json` and `ng serve --port`. Vite's own 5173 / 4173 only where `strictPort` keeps it there (`default`, a guess); no other default |
| A port handed through code | `start(3001)` where `start = (port) => app.listen(port)`, `bootstrap({ port: 3002 })`, `(options) => app.listen(options.port)`, through up to three functions, each call its own port with `handed` naming it |
| A settings object | `app.listen(config.port)` where a literal object in any file of the repository writes `port` (a fallback read with its setting); NestJS's `config.get('app.port')` through `registerAs('app', …)` or a `ConfigModule.forRoot({ load })` factory; convict's `config.get('port')` through the schema's `default` and `env` |
| A setting alone | `app.listen(process.env.AUDIT_PORT)` is kept as `{ setting, file, line }`, and the service's own example environment file fills it (`AUDIT_PORT=3006`), whatever the setting is called |
| A container | a compose service's `ports` (`"3001:3000"`, `"127.0.0.1:3001:3000/tcp"`, `{ published, target }`), `environment` and `env_file`; `docker run -p 3009:3000 --name n -e PORT=3000` in a `package.json` script of the service |

A container mapping is reconciled with the code: the port the service listens
on inside the container - the value its environment gives the setting the code
reads, or else the code's own port - meets the mapping's container side. A
request to `localhost:3001` then joins with
`listensAt: src/app.ts:10, published as 3001 by docker-compose.yml`
(`heuristic`: the mapping holds where the container runs), and a request on the
container's network to `orders:3000` with
`listensAt: src/app.ts:10, in the container orders (docker-compose.yml)`; the
settings' hosts say which side each came from (`mapped.side`). A mapping whose
container side the code does not listen on is the note `published-port-unheard`
at the mapping's line, and the request is still joined by the file. A front
end's dev server whose proxy is not read forwards what it does not serve, so a
request to its port that its service has no route for is decided by the next
way. `fixtures/port-sources-joins` shows each case.

**Where a request is forwarded, and where a container listens (P257).** A
server's proxy is read where its framework writes it, kept on the repository
node as `meta.proxy: [{ path, target, to, file, line, after? }]`:

| Server | Read |
|---|---|
| Vite (React, Vue, Svelte, SvelteKit and any Vite front end) | `server.proxy` and `preview.proxy`: `'/api': 'http://localhost:3001'`, `{ target, rewrite: (path) => path.replace(/^\/api/, '') }` |
| Angular | the `proxyConfig` of the `serve` target in `angular.json` or `project.json`, and `ng serve --proxy-config`: `proxy.conf.json` or a module exporting the table, `{ "/api": { "target", "pathRewrite": { "^/api": "" } } }` or `[{ "context": [...], "target" }]` |
| Nuxt, Nitro | `nitro.devProxy` (`devProxy` in `nitro.config.*`), which mounts the target at its prefix and so takes the prefix off; a route rule's `proxy` in `routeRules` and `nitro.routeRules`, `'/api/**': { proxy: 'http://localhost:3001/**' }` |
| Next | what `rewrites()` answers, a list or `{ beforeFiles, afterFiles, fallback }`, where the `destination` is an address outside the application; a trailing catch-all (`/:path*`) is the rest of the path |
| Create React App | `"proxy"` in `package.json`: every request its dev server has no file for, path unchanged |
| A workspace tool's webpack dev server | the `proxyConfig` of an `@nx/webpack:dev-server` (`@nx/react`, `@nx/web`) target in `project.json` |

A request with no host, from a front end whose server forwards its path, and a
request to such a server's own port (`localhost:5180/api/orders`), join the
service at the target's host at the rewritten path (`/orders`): `via: proxy`,
`heuristic` (a proxy is how a server is run, not what the code says), the edge
carrying `proxiedBy` (the rule's `file:line`), `proxiedAs` (where the path
changes) and the target's `listensAt`. A rule is matched before the server's own
routes, except Next's rewrites after its files and Create React App's proxy,
which only take what the server does not serve. A path the target serves no
route for is `target-route-not-found` at that service; a target no service is
reached at is drawn as a third party (`calls`, `via: proxy`) with the note
`proxied-to-third-party`. The dev server's own host is not drawn as a third
party where its proxy forwards. A rule whose prefix is a pattern, whose target
is not written as an address, or whose rewrite is anything but a literal
replacement of its prefix is the row `proxy-rule-unread`, and the requests
under it are decided as if no proxy were there. `fixtures/dev-proxy-joins`
shows each case.

A cluster's manifests are read from every service's repository and beside the
configuration: plain YAML files, several documents to a file, declaring a
`Deployment`, `StatefulSet`, `DaemonSet` or `ReplicaSet` (its pods' labels, its
containers' named ports and literal `env`) and a `Service` (its name, namespace,
selector and each `port` → `targetPort`, a named one resolved through the pods
it selects). A service object is the project's service whose workload it
selects (a workload known by the service's name, its pods' `app` labels, a
container's or an image's name, or the only workload a service's own
repository declares), or the service of its own name where it selects none. A
chart is rendered with its values and a kustomization built with its patches
and overlays (P260, below); a template outside a chart is read where its values
are literal: a line that is only a directive is dropped, and a value that is a
template expression is not read (a port or a name written so is skipped). Each name a service object
routes is a host (`orders`, and with a namespace `orders.shop`,
`orders.shop.svc`, `orders.shop.svc.cluster.local`), and its ports are hosts
with `mapped.side: 'routed'`. A request to `http://orders/orders` (the port the
scheme defaults to where none is written) joins with
`listensAt: src/server.ts:10, behind orders:80 (k8s/orders.yaml)`, the pods'
environment outranking the code's fallback as a container's does; a `targetPort`
the code does not listen on is `published-port-unheard`.

A request on a container's or a cluster's network to a port the service is not
reached at there - a compose or `docker run` mapping's published side
(`search:4010` where `4010:3000`), or the containers' own port behind a routed
name (`orders:3000` where `orders:80` routes to 3000) - will not connect: it is
the finding `network-port-unreachable` naming the hosts that do reach it, and
is not joined (counted under `noRoute` for a server's request).

The last ways a port is set: `docker run -p` in a `Makefile`, a `*.mk` or a
`*.sh` file at the top of the service or in its `scripts/` or `bin/` (a command
continued with `\` read as one); the `port` of a workspace tool's target in
`project.json` whose executor starts a server (`@nx/next:server`,
`@nx/vite:dev-server` and `preview-server`, `@nx/webpack:dev-server`,
`@nx/angular:dev-server` and Angular's own builders; never `@nx/js:node`, whose
`port` is the debugger's); and a NestJS settings object handed in by its token,
`config.port` of `@Inject(appConfig.KEY) config: ConfigType<typeof appConfig>`,
of `app.get(appConfig.KEY)` or of any value typed `ConfigType<typeof
appConfig>`, read at the `registerAs` factory's key. `fixtures/cluster-port-joins`
shows each case.

**Every way a cluster or a proxy routes a request (P260).** Manifests are read
the way the tools that apply them build them.

| Written as | Read |
|---|---|
| A chart (a folder with `Chart.yaml`) | each template of `templates/` rendered with the chart's `values.yaml`, then the values files (`-f`, `--values`) and `--set`s of the `helm install`, `helm upgrade` or `helm template` a script, a Makefile or a `package.json` of the service or the project runs, its release name (the chart's name where no command names one) and `--namespace`; value lookups, pipelines (`default`, `quote`, `printf`, `toYaml \| nindent`, `include` of a `define` in a `.tpl` helper), variables, `if` / `else if` / `else`, `with`, `range`, `template` |
| A kustomization | the files and folders `resources`, `bases` and `components` list (another folder's kustomization built first), `patches` and `patchesStrategicMerge` (strategic merge: containers, env and ports merged by name or port) and `patchesJson6902` (`add`, `replace`, `remove`), `images`, `namespace`, `namePrefix`, `nameSuffix` (reaching an `Ingress`'s backends too); `replicas` and labels say nothing a join needs |
| An `Ingress` | each rule's `host` and path (`pathType` `Prefix` by whole segments, `Exact`, and under `nginx.ingress.kubernetes.io/use-regex` or `rewrite-target` a pattern matched from the start, ignoring case), its backend's service object and port (by number or name), `defaultBackend`, and `rewrite-target` with its groups (`/$2`) |
| An `HTTPRoute` | its `hostnames` (or its parent `Gateway`'s listeners' `hostname`), each match's `PathPrefix`, `Exact` or `RegularExpression`, its `backendRefs`, and a `URLRewrite` filter's `ReplacePrefixMatch` or `ReplaceFullPath` |
| A `NodePort` or `LoadBalancer` service object | each port's `nodePort`, reached at `localhost:<nodePort>` where the cluster runs on the machine |
| `kubectl port-forward` | in a script or a Makefile of a service or the project: `svc/orders 8080:80` reaches what the object routes port 80 to, `deploy/stock 4001:4000` the pods' port 4000 |

A template condition the values decide is decided; one they cannot (a value
the cluster answers, `.Capabilities`, `lookup`, a function the reader does not
know) is rendered both ways, every way up to sixteen, and where the ways
declare the same ports, names and routes they are read, and where they do not
the template's literal lines are read and the row `manifest-unread` says
which conditions. A value nothing gives is read as nothing written. Where
overlays build on one base, or a chart is installed several ways, and they
declare different ports, names or routes, the one the configuration names
(`settingFiles.overlays`, `settingFiles.chartValues`) or whose folder or values
file is named for `settingFiles.environment` is read; with no choice the base
(or the chart's own values) is read alone and the row
`manifest-overlay-unchosen` says so. A patch operation other than `add`,
`replace` and `remove`, a base outside the project and a way in that splits a
path between two services by weight are `manifest-unread`. Each row is said by
the service the objects it names are.

A request to a public host a way in routes (`https://shop.example.test/orders`)
joins the service behind the object its rule sends to, at the path the rule
rewrites it to: `via: ingress`, `heuristic`, `proxiedBy` (the rule's
`file:line`), `wayIn` (`ingress/shop`, `http-route/inventory`), `proxiedAs`
where the path changes, and the service's `listensAt` behind the name. A rule
for the path exactly is taken first, then the longest prefix of whole segments,
a pattern by the segments it starts with as literals and before a prefix as
long. A request with no host from a front end a way in serves at a public host
is a request to that host. A request to `localhost:30080` joins with
`listensAt: …, at node port 30080 of orders (charts/orders/templates/service.yaml)`,
and one to a forwarded port with
`listensAt: …, forwarded from 8081 to svc/catalog by Makefile`.

The proxy rules P257 left out are read too. A Vite key that starts with `^`
is a regular expression the whole path is matched by. A rewrite that is any
regular expression replaced by a literal (`path.replace(/^\/api\/v\d+/, '')`,
`pathRewrite: { '^/catalog/v\\d+': '' }`) rewrites the whole path. A target
read from a setting (`target: process.env.ORDERS_URL`, `env.VITE_API_URL` of
`loadEnv`, `` `${process.env.ORDERS_URL}/orders/:path*` `` in a Next rewrite,
a route rule's `proxy` built over one) takes the one address the service's own
files give the setting (P77), or the literal fallback written beside it, and
the edge says `proxiedTo: [ORDERS_URL from .env.example]` (one entry per hop
whose target a setting gives, in the order the request passes them, P263); with neither it is
`proxy-rule-unread`. An http-proxy-middleware `router` written as a table sends
a path key under the prefix to its own target, rewritten as the prefix is; a
key with a host routes by the request's host and is a row. A request forwarded
to a server whose own proxy forwards it again is followed again, through up to
four servers, the edge carrying `proxiedThen` with each later rule; a longer
chain, or one that comes back to a server it passed, is the row
`proxy-chain-unfollowed` and is not joined. A Next server's request with no
host (`fetch('/api/health')` in a server component, in a page its server half
reads) is a request to its own address: its own route, or where its rewrites
send it (`via: ownOrigin`, `heuristic`); where the browser makes the same
request in the same place, what is wrong with it is said once, by the
browser's. `fixtures/cluster-route-joins` and `fixtures/proxy-chain-joins` show
each case.

**Every way a cluster is installed and a server asks itself (P263).** What
installs the manifests is read as well as the manifests.

| Written as | Read |
|---|---|
| A `helmfile.yaml` (or `helmfile.yaml.gotmpl`, `helmfile.d/`) at the top of a service or the project, or one `helmfile -f` names | each part rendered over the environment (`.Environment.Name`, `.Values`, `.StateValues`), `environments.<name>.values` (files, `.gotmpl` rendered, or inline), and each release's chart (a folder of the project), values files and inline values in order, `set`, `namespace`; `installed: false` and a false `condition` leave it out. One install per release per environment: those `helmfile -e` commands name, else every one it declares |
| A chart's dependencies | each `dependencies` entry of `Chart.yaml` (or `requirements.yaml`) with a `file://` repository, and every chart unpacked in `charts/`, rendered inside the parent's release with the parent's `<alias or name>:` values and `global:`, the helpers of the whole tree shared; a `condition` or every `tags` false leaves it out. Read only through the parent unless a command installs it itself; a packed or a repository's chart is not in the project |
| A kustomization's `helmCharts` | a chart under `helmGlobals.chartHome` (default `charts`) rendered with its `valuesFile`, `additionalValuesFiles`, `valuesInline`, `releaseName` and `namespace`, part of the build; one only a repository has is `manifest-unread` |
| `configMapGenerator`, `secretGenerator` | a `ConfigMap` or `Secret` of the build from `literals` and `envs` files (`behavior: merge` / `replace` change the base's); `files` are contents, not an environment |
| `replacements` | the value at a source's `fieldPath` (`delimiter` / `index` picking a part) written at each target's `fieldPaths` (`a.b.[name=x].c`, an index, `*`, `create`), after every other transformer; a source not built or a path not there is `manifest-unread`. `vars` are not substituted and are `manifest-unread` |
| A pod's environment from a config map or a secret | `envFrom` (`configMapRef`, `secretRef`, `prefix`) and `env[].valueFrom` (`configMapKeyRef`, `secretKeyRef`) of a `ConfigMap` or `Secret` of the same manifests, said at the file that writes the value (`PORT from deploy/base/stock.env`) |
| An `Ingress` rule with no `host` | a way in at any host the controller is reached at, followed for the requests with no host of a front end it serves; not for a public host another rule names (ingress-nginx serves such a host by its own rules alone, other controllers fall back) nor for a host no rule names (nothing says it reaches the cluster). Each path of an `Ingress` is a way in at its own rule's host |
| Commands in pipelines | `helm install` / `upgrade` / `template`, `helmfile`, `kubectl apply -k`, `kubectl kustomize`, `kustomize build` and `kubectl port-forward` in a GitHub workflow's `run:` and a GitLab job's `script:`, as in a script or a Makefile (`*.mk`, `GNUmakefile` too); the overlays commands apply are the ones one is chosen among, and one they alone apply is read. A pipeline's `docker run` is not a container of the service: it runs on the pipeline's machine |

A server's own request with no host is said where it will not work. In a
service whose server resolves its requests against its own address (Next, and
now Nitro and Nuxt), a request the platform `fetch` (or `ofetch` imported) makes
with a path and no host is drawn to the route the path names, as P260 drew it,
and the finding `server-request-without-origin` says it throws as written: on
the server there is no page address to resolve it against. It is not said where
the browser makes the same request at the same place, unless the file holds
one of the service's own ways in (a route handler runs on the server whoever
else reads it), nor for a client whose base the reader does not see (an axios
instance). Nitro's `$fetch('/api/orders')` on the server is a call into the
same service: its routes answer it in process, so it joins its own route
`via: inProcess`, `static`, or where its route rules and `devProxy` forward it,
and nothing more is said; a `$fetch` whose options write a `baseURL` is not
read. `fixtures/cluster-install-joins` and `fixtures/own-origin-requests` show
each case.

A custom broker entry:

```jsonc
{
  "name": "in-house-bus",
  "channelKind": "channel",
  "producers": [
    {
      "receiverType": ["EventBusService"],  // the class publishing through it
      "method": "publish",                  // the method that sends
      "channelArg": 0,                      // which argument names the channel
      "payloadArg": 1,                      // which one carries the message
      "kind": "event"
    }
  ],
  "consumers": ["OnEvent"],                 // decorator names that mark a handler
  "subscribers": [
    {
      "receiverType": ["Broadcaster"],      // the class receiving is asked of
      "method": "pSubscribe",               // the call that begins listening
      "channelArg": 0,                      // which argument names the channel
      "handlerArg": 1,                      // which one holds what runs
      "kind": "event"
    }
  ]
}
```

### Where the channel name is written

`channelArg` says "argument 0", and most buses are written that way. Two common
house styles are not, and for those a producer, a subscriber or a consumer takes
`channel` instead: a list of **locators**, tried in order, first that yields a
readable name wins. `channel` replaces `channelArg` where both are given.

| Locator | Reads |
|---|---|
| `{ "kind": "argument", "index": 0 }` | argument 0, which is what `channelArg: 0` means |
| `{ "kind": "argument-property", "index": 0, "key": "name" }` | the `name` property of argument 0, written out or as a shorthand |
| `{ "kind": "base-constructor-argument", "index": 0 }` | argument 0 of the `super(...)` in the class the receiver was declared as |
| `{ "kind": "receiver" }` | the expression the call was made on |
| `{ "kind": "receiver-type" }` | the declaration of the receiver's declared type |
| `{ "kind": "provider-decorator", "decorator": "InjectQueue", "index": 0 }` | argument 0 of that decorator on the constructor parameter that provided the receiver |
| `{ "kind": "chain-call", "method": "from", "index": 0 }` | argument 0 of `from(...)` anywhere in the same chain |
| `{ "kind": "chain-root-argument", "index": 0 }` | argument 0 of the call the chain started from |
| `{ "kind": "argument-path", "index": 0, "path": ["Entries", "*", "DetailType"] }` | a path of properties inside argument 0; `*` is every element of an array |
| `{ "kind": "constructed-argument-path", "class": "PutEventsCommand", "path": ["Entries", "*", "DetailType"] }` | the same path inside what `PutEventsCommand` is constructed with, where the construction is an argument of the call — built in the call or in a `const` before it. `"index": 1` starts the path in the constructor's second argument |
| `{ "kind": "receiver-constructed-path", "class": "Upload", "path": ["params", "Bucket"] }` | the path inside what the receiver was constructed with - `new Upload({ params: { Bucket } }).done()`, or the same `new` in a `const` before the call |
| `{ "kind": "origin-call-argument", "call": "create", "path": ["process"] }` | the path inside the argument of the earlier `create(...)` that made a value this call is handed - `run.id` after `const run = await create(...)` - on the same receiver or from the same module, in the same body, through `const` bindings only. See [a start addressed by a record](#code-that-starts-a-workflow-or-a-function) |

**A path through a list is one name per element.** `["Entries", "*", "DetailType"]`
over two entries is two channels, not one, and every part of an address that
walks the same list is read at the same element. A path also goes through a
record or a list kept in a `const`. Where the list is built at run time —
`entries.map(...)` — or a spread may supply the key, the walk stops there and the
row names that expression; a key that is simply not written is *nothing written*,
which an address part may fill with `absent`.

**`constructed-argument-path` is a condition as well as a place.** A client that
sends commands sends every kind of them through one method, and a call handed some
other command is not a publish whose channel could not be read: the description
does not apply to it, and it produces nothing. A command the checker can see is an
instance of the class but whose construction is somewhere else — a parameter — is
of the shape, and is reported as a channel that cannot be read.

### An address in parts, and a message inside the input

Some transports name a message with several words that only together say where it
goes. A producer may then take `address` instead of `channel`: a list of parts,
joined with `/` into the channel's name. Each part is a word the description
states, `{ "literal": "eventbridge" }`, or a place the call writes it:

| Key | Says |
|---|---|
| `at` | locators, tried in order, as for `channel` |
| `absent` | what the part is when the call writes nothing there, because the library fills it in. Never used for a value that is written and cannot be read |
| `forms` | longer spellings the name may be written inside — a URL, an ARN — each a regular expression whose first group is the name |

`channel` is a one-part address written short, and `channelArg` is a one-part
address of one plain argument. A part that is written and cannot be read leaves
the whole address unread: half an address joins nothing it should.

`payload` is where the message is written, as locators, for a call whose message
is a property of its input rather than an argument of its own; it overrides
`payloadArg`. It is read at the same element as the address, and a message sent
as `JSON.stringify(value)` is read as the value, because that is what the receiver
parses back out.

A project's own helper around the AWS SDK, described so that each call lands on
the channel the SDK itself would have named:

```jsonc
{
  "name": "library-events",
  "channelKind": "topic",
  "producers": [
    {
      "receiverType": "LibraryEventBus",
      "method": "put",                      // libraryEvents.put(new LibraryEvent({ type, detail }))
      "address": [
        { "literal": "eventbridge" },
        { "literal": "library-events" },    // the bus the helper always uses
        { "literal": "library.returns" },   // and its source
        { "at": [{ "kind": "constructed-argument-path", "class": "LibraryEvent", "path": ["type"] }] }
      ],
      "payload": [{ "kind": "constructed-argument-path", "class": "LibraryEvent", "path": ["detail"] }],
      "kind": "event"
    }
  ]
}
```

**A helper written as a function** has no receiver to name. A producer may give
`function` — the name the function is declared with, whatever an import renames it
to — in place of `receiverType` and `method`. A helper that sends whatever command
it is handed, `publishEvent(new PutEventsCommand({ Entries: [...] }))`, is
described with the same locator the SDK's own description uses:

```jsonc
{
  "function": "publishEvent",
  "address": [
    { "literal": "eventbridge" },
    { "at": [{ "kind": "constructed-argument-path", "class": "PutEventsCommand", "path": ["Entries", "*", "EventBusName"] }], "absent": "default" },
    { "at": [{ "kind": "constructed-argument-path", "class": "PutEventsCommand", "path": ["Entries", "*", "Source"] }] },
    { "at": [{ "kind": "constructed-argument-path", "class": "PutEventsCommand", "path": ["Entries", "*", "DetailType"] }] }
  ],
  "payload": [{ "kind": "constructed-argument-path", "class": "PutEventsCommand", "path": ["Entries", "*", "Detail"] }],
  "kind": "event"
}
```

The helper's own call to the SDK is still read, and has no channel: the command
it sends was built by its caller, which is what the description is for.

### Your own extraction patterns

A wrapper of the project's own - a bus, an HTTP client, a data kit, a helper
that starts a workflow - is read through a description under `adapters`, and a
pattern file is the friendlier way to write one (P121): the call written as
code, the holes in it named, and tests beside it. List the files under
`patterns` (top level, or per service); each is a YAML list of rules:

```yaml
- id: shop-bus-emit
  kind: publish                  # publish | subscribe | consume-decorator | http-request | start | table
  on:
    receiverType: ShopBus        # or: function: emitEvent   (with module?: '@acme/bus'), or factory: useApi
  pattern: "$BUS.emit({ topic: $CHANNEL, data: $PAYLOAD })"
  channel: $CHANNEL
  payload: $PAYLOAD
  note: our bus wraps the broker; one call per event
  tests:
    - code: "bus.emit({ topic: 'book.added', data: book })"
      expect: { channel: book.added }
    - code: "bus.emit({ topic: topicFor(kind), data })"
      expect: { channel: '*', row: channel-dynamic }
    - code: bus.flush()
      expect: none
```

Quote a pattern or a test's code that holds `: `, because YAML reads an unquoted
`: ` as a key; a block scalar (`pattern: |`) works too.

**The pattern language.** A pattern is one TypeScript expression, read by the
TypeScript parser: the call, or `@Decorator(...)` for a `consume-decorator`
rule. `$NAME` is a hole that names one node, `$$$NAME` a run of arguments, `_`
anything. Matching is structural on the call: the method or the function by its
name, arguments by position, the keys of an object argument in any order with
extra keys allowed, a list's one element for every element (`[{ Name: $N }]`),
a chain (`$CLIENT.queue($Q).add($JOB, $PAYLOAD)`), a construction handed to the
call (`$C.send(new SendCommand({ Name: $N }))`) or the one the receiver is
(`new Upload({ params: { Bucket: $B } }).done()`), a receiver made by a call of
a function (`useApi().send(...)`). A literal must match literally: it becomes a
condition the call must meet (`where`), so `$API.call('POST', $URL)` reads only
the calls whose first argument is `'POST'`. A test's `expect` states `channel`
(`*` for one that cannot be read), `verb`, `url`, `table`, `name` (what a start
reaches) and `row` (a reason the code leaves), any of them, or `none`.

**Which hole is which.** The rule's fields name holes: `channel` and `payload`
(publish), `channel` and `handler` (subscribe), `channel` (consume-decorator),
`url`, `body` and `verb` (http-request; `verb: POST` fixes it, and with no `verb`
the method's own name is the verb), `name` with `target: workflow | invoke` and
`names` (start), `table` and `op` (table; the operation is the method name's
first word when `op` is not said). A field may also be a value: `channel:
heartbeat`, `table: audit_log`. The receiver's hole has three forms for where
its name is stated once rather than at the call: `$Q:type` (the receiver's
declared type), `$Q:constructor(0)` (an argument of its base-constructor call),
`$Q:decorator(InjectQueue, 0)` (the decorator on whatever provided it).
`channelKind` and `messageKind` are what the transport calls the channel and
what the node records.

**Compiled, not interpreted.** Each rule compiles into the description the
readers already read - a publish, a subscription or a decorator into
`broker.custom` (a bus named `pattern:<id>`), a start into `starters`, a table
access into `db.tables`, a request into `http.clients` - with each hole as the
locator that reaches the same place: a whole argument is `argument`, a key of an
object argument `argument-property` or `argument-path`, a hole further up the
chain `chain-call` or `chain-root-argument`, the receiver `receiver`. Every node
a rule draws carries `meta.describedBy: "pattern:<id>"`. What cannot be said as
locators - a hole inside a callback, a spread, a hole after a run of arguments,
a receiver written as a name rather than a hole with its type - refuses the rule
at load with `pattern-not-expressible`, naming the part; nothing of it is read.

Every description takes the two keys a compiled rule uses, and may be written
with them by hand: `where: [{ "at": <locator>, "equals": <value> }]`, values the
call (or the decorator) must write for the description to apply, and
`describedBy`, the rule it came from. A `broker.custom` producer also takes
`module` beside `function`, for a publishing function a package exports.

**Precedence.** A description written by hand - the tool's own or one in the
configuration - wins over a pattern on the same call, and the pattern is
`pattern-shadowed` (info) there. Two patterns on one call are
`pattern-ambiguous` and neither is read. A rule nothing in the services it
applies to matches is `pattern-unmatched` (info), said once the build has read
them all. A name read from a literal is `static`, a receiver known only from
what the source states (a class nobody installed) makes the edge `heuristic`,
and a hole that cannot be read is `*` with its row, as for every description.

**Calls a pattern covers stop being Can't follow places.** A call whose
receiver could not be typed (`call-dynamic-receiver`) and that a description now
reads - a publish, a subscription, a request, a table access - loses its row, so
the next build counts the place as followed.

### The AWS SDK

Publishing through EventBridge, SQS and SNS, writing to a bucket or a DynamoDB
table and putting a record on a Kinesis stream are read without configuration,
from `@aws-sdk/client-eventbridge`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sns`,
`@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`,
`@aws-sdk/client-kinesis` and `aws-sdk` (version 2). The package may be declared in the repository's own
manifest or in any manifest below it, for a repository that keeps one per
function. Three shapes of call are read for each operation: a command sent with
`client.send(new XCommand(input))`, built in the call or in a `const`; version 3's
aggregated client, `client.putEvents(input)`; and version 2,
`service.putEvents(input).promise()`.

| Operation | Channel | Message |
|---|---|---|
| EventBridge `PutEvents` | `eventbridge/<bus>/<source>/<detail type>`, one per entry; an entry with no `EventBusName` is on `default` | `Detail` |
| SQS `SendMessage`, `SendMessageBatch` | `sqs/<queue name>`, from `QueueUrl` | `MessageBody` |
| SNS `Publish`, `PublishBatch` | `sns/<topic name>`, from `TopicArn` | `Message` |
| S3 `PutObject`, `CopyObject`, `CompleteMultipartUpload`, `DeleteObject`, `DeleteObjects`; version 2's `upload`; `@aws-sdk/lib-storage`'s `new Upload({ params }).done()` | `s3/<bucket name>`, from `Bucket` | none: recorded as the event it fires (`s3:ObjectCreated:Put`, `s3:ObjectRemoved:Delete`, any of `s3:ObjectCreated:*` for an upload), with the `Key` it writes and, for a delete, whether it names a `VersionId` |
| `getSignedUrl` (`@aws-sdk/s3-request-presigner`) of a `PutObjectCommand` | the same | none: the browser handed the URL writes, so every edge is `heuristic` with `because: ["presigned"]` |
| DynamoDB `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactWriteItems`; the document client's `put`, `update`, `delete`, `batchWrite`, `transactWrite` (`PutCommand` and the rest from `@aws-sdk/lib-dynamodb`, `DocumentClient` in version 2) | `dynamodb/<table name>`, from `TableName`, each key of a batch's `RequestItems` (a string, a computed key, or a bare word or shorthand property, which names the table it spells), or each `Put`, `Update` or `Delete` of a transaction (a `ConditionCheck` writes nothing) — only where the table's stream is declared | `Item`, or `Key`; none for a batch or a transaction |
| Kinesis `PutRecord`, `PutRecords` | `kinesis/<stream name>`, from `StreamName` or `StreamARN` | `Data` |

A channel is named by the deployed name, never by the URL or ARN the code holds:
`https://sqs.eu-west-1.amazonaws.com/111122223333/returns` is `sqs/returns`, and
a bus's ARN is the bus's name. The service comes first because a queue and a topic
are often given the same name and are not the same channel. A subscriber read from
the deployment arrives at the same name, so the two meet on one node.

**A write to a bucket is taken by the notifications that take it.** The writer
records the event it fires and the key it writes, as written - a template is a
pattern, `incoming/*.png`; each notification read from the deployment records
the events and key filters it takes. The linker asks of every write which
notifications take it, puts their ids on the edge as `takenBy`, and a walk
through the bucket from that write goes on to those alone. The edge stays
`static` where one surely does; where the key is not read and a notification
filters on keys, or a filter reaches past what a template fixes, it is
`heuristic` with the reason in `because`. A write nothing takes is an `info` row,
`s3-write-matches-nothing` (`fixtures/lambda-terraform-bucket-notification`).

**A write to a table is a publish only where its stream is.** A table's writes
reach whatever a mapping from its stream runs, and nobody when it has none; the
call does not say which, the deployment does, in whichever repository deploys
the table. So a write is drawn onto `dynamodb/<table>`, and the linker keeps it
only where some service's Terraform declares that stream — `stream_enabled =
true` or a `stream_view_type` on `aws_dynamodb_table`, or a mapping reading its
`stream_arn`. A write to a table with no stream is no channel: no edge, no row.
A read — `GetItem`, `Query`, `Scan` — is not described and never joins. A record
put on a Kinesis stream is always a publish (`fixtures/lambda-terraform-table-stream`).

These are descriptions in the vocabulary above: each operation is the locators and
parts a configuration could write, plus the one thing a configuration cannot say,
the package the client comes from (`fixtures/aws-sdk-publishers`). With nothing
installed, a client is recognised by its construction and the import beside it,
and every edge read that way is `heuristic` (`fixtures/aws-sdk-not-installed`).

Starting a workflow and invoking a function are rows of the same table, read
the same three ways from `@aws-sdk/client-sfn`, `@aws-sdk/client-lambda` and
`aws-sdk` (where Step Functions is `StepFunctions`): Step Functions
`StartExecution` and `StartSyncExecution` by `stateMachineArn`, and Lambda
`Invoke` by `FunctionName`. They name no channel; see [Code that starts a
workflow or a function](#code-that-starts-a-workflow-or-a-function).

**A queue, topic or bus named by `process.env` is completed from the
deployment.** The variable's name is not the resource's, and its value is set
where the code is deployed. The extractor draws the publisher with no channel
and a `channel-from-environment` row naming the variable, and the producer keeps
the address it is waiting on in `meta.awaiting` — each missing part named by its
variable, with the message it carries. Where a function whose deployment is read
runs the call, the linker completes the address from the value that function is
deployed with and the row goes; where nothing deployed runs it, the row stays.
Who receives — a rule, a subscription, a mapping from a queue to a function — is
read from the deployment too (see *Subscribers declared in Terraform* below).

A bus that addresses jobs as an options object and wraps each queue in a class of
its own is described like this — and note that the handler needs describing the
same way, because a channel with one end joins nothing:

```jsonc
{
  "name": "house-jobs",
  "channelKind": "queue",
  "producers": [
    {
      "receiverType": ["JobBus"],
      "method": "queue",                    // jobs.queue({ name, data })
      "channel": [{ "kind": "argument-property", "index": 0, "key": "name" }],
      "payloadArg": 0,
      "payloadPath": ["data"],              // the message is one property in
      "kind": "job"
    },
    {
      "receiverType": ["MailQueue", "DigestQueue"],
      "method": "push",                     // this.mail.push(payload)
      "channel": [{ "kind": "base-constructor-argument", "index": 0 }],
      "payloadArg": 0,
      "kind": "job"
    }
  ],
  "consumers": [
    {
      "decorator": "OnJob",                 // @OnJob({ name, queue })
      "channel": [{ "kind": "argument-property", "index": 0, "key": "name" }],
      "kind": "job"
    }
  ]
}
```

**The order matters.** A flat record is itself a legal channel address — a
framework's own transport matches `send({ cmd: 'sum' })` against a handler
written the same way — so a plain `argument` locator does not fail on an options
object, it succeeds with a name nothing at the other end can ever write. List the
narrower locator first.

**`payloadPath` says where the message sits inside what `payloadArg` points at.**
A call handed a record holding the name and the message together is publishing
the message, not the record, and the handler at the other end is given the
message alone. Left out, the whole argument is the message, which is right for a
call that takes it plainly. Getting it wrong is not a missing row: the two ends
of one channel are compared as they stand, and a correct handler is reported as
requiring a field nobody sends.

A `consumers` entry may be a bare decorator name, which means what it always
meant: the channel is that decorator's first argument. Written out it takes
`decorator`, an optional `classDecorator` for a worker class that states its
channel above the class rather than on each method, `channel`, `kind`, and the
same pair for the receiving end — `payloadArg`, which of the handler's parameters
the message arrives in, and `payloadPath`, where inside it the message sits.

A name no locator can read produces a publisher or a handler with no channel and
a row saying which call to look at. It never produces a channel node: a guessed
name would silently join two services that never speak.

**`consumers` and `subscribers` are the two ways a bus says who listens.** A bus
with a decorator per handler is described by `consumers`; one where receiving is
a call is described by `subscribers`. Without either, its channels are read as
all publishers and no handlers, which reads as though nothing anywhere listens.
A subscriber's `method` may be one name or a list of them, for a verb a transport
spells more than one way — two clients of it, or two major versions of one, and a
description holding one spelling reads the others as nothing at all.

The channel a subscriber names may contain `*`, and it meets a publisher's
template on the same node: `` `orders:${id}:created` `` and `'orders:*:created'`
are both `channel:orders:*:created`.

A listener that does exactly one thing is an alias for that thing, so the
consumer lands on the method it delegates to. One that does several is its own
step: the consumer stays on the method that registered it and a row says so.

A handler registry entry:

```jsonc
{
  "name": "callbacks",              // how it is named in reports
  "receiver": "callbackRegistry",   // the object, spelled as it is written
  "method": "register",             // the method that fills the table
  "keyArg": 0,                      // which argument is the key a person presses
  "handlerArg": 1,                  // which one is the function that answers it
  "kind": "bot_callback"            // the kind of entry each registration opens
}
```

Every `callbackRegistry.register('confirm_cancel', confirmCancelHandler)` then
becomes an ordinary entry point, handled by the function named. A function used
this way is a node of its own, and so is anything it calls by name — nothing else
in a repository becomes one.

The object has to be declared in the repository being read, so an import from a
package that happens to share the name is not matched. `receiver` may be a list.
This is read wherever handlers are installed by call rather than by decorator,
which today means a repository depending on `telegraf`; anywhere else, turn it on
with `adapters.force.entry`.

**A registry description has no `packages` key, and will not be getting one.**
An HTTP description names a dependency because a framework is something you
install, and what you installed is written in your manifest. A table of
functions you wrote yourself is installed from nowhere, so there is nothing
there to name. Where such a description applies is `receiver` — the name your
own source writes the table under — and that is a stronger statement than a
dependency would be, because it names the table rather than a library sitting
next to it. It is also read too late to decide detection, which answers from
`package.json` before a source file is opened: a description whose receiver is
written nowhere in a repository simply matches nothing there, which is what an
absent dependency would have got you anyway. A `packages` key would have to mean
what it means for HTTP, where empty means everywhere — and empty is exactly what
you would write, having no dependency to name, so describing one table in one
repository would put `entry-registries` on every repository node of your
project. Naming some dependency to avoid that would name the repository rather
than the table, and every repository of yours that shares it would claim the
description too. So whether this reader runs is decided by the repository's
dependencies and by `adapters.force.entry`, and the description decides only
where inside a repository it matches.

**A table nobody configured is reported rather than skipped.** A repository with
handlers registered through an object it declares itself gets one `unresolved`
row per receiver, saying how many registrations were seen and naming this key. A
repository that depends on a bot library and has no readable registration at all
gets one `bot-handlers-not-found` row.

An HTTP framework entry:

```jsonc
{
  "name": "minihttp-routes",                 // how it is named in reports
  "packages": ["minihttp"],                  // a dependency that means it is in use
  "appTypes": [
    {
      "packages": ["minihttp"],              // where the type comes from
      "typeNames": ["Server"]                // the type routes are declared on
    }
  ],
  "verbs": { "get": "GET", "post": "POST" }, // method name to the verb it answers
  "verbArgument": "on",                      // a method taking the verb as its first argument
  "pathArg": 0,                              // which argument spells the path
  "handlerArg": -1,                          // which one answers; -1 is the last
  "middlewareBetween": true,                 // the ones between them are that route's middleware
  "prefixMethod": "basePath",                // returns the application with a prefix in front
  "prefixMutates": false,                    // true when it changes the one it is called on
  "prefixOption": "prefix",                  // a constructor option that prefixes the whole router
  "pathMethod": "route",                     // returns a route object the verbs are written on
  "mount": {
    "method": "attach",                      // the call that hangs one application in another
    "appArg": 1,                             // which argument is the application; -1 is the last
    "pathArg": 0,                            // which one spells the path it is hung at
    "prefixKey": { "arg": 1, "key": "prefix" },  // or an options key that spells it
    "asPlugin": false,                       // true when the application is the argument's first parameter
    "through": ["routes"]                    // methods turning an application into middleware
  },
  "middleware": {
    "method": "use",                         // the call that installs it on a whole application
    "scoped": true,                          // the first argument may be a path it is scoped to
    "named": false,                          // true when the first argument names a lifecycle hook
    "optionKeys": ["preHandler"]             // keys of a route's options object holding middleware
  },
  "routeObject": {
    "method": "route",                       // a route declared by one object argument
    "verbKey": "method",
    "pathKey": "url",
    "handlerKey": "handler"
  },
  "request": {                               // where a handler finds the request, and how it answers
    "parts": {
      "body": [{ "param": 0, "at": ["payload"] }],     // a parameter and keys from it
      "params": [{ "param": 0, "at": ["params"] }],
      "query": [{ "param": 0, "at": ["query"] }]
    },
    "calls": [                               // methods that hand a part back: `await req.read()`
      { "param": 0, "at": [], "method": "read", "part": "body", "claim": true }
    ],
    "answers": [                             // how a handler answers it
      { "by": "call", "param": 1, "methods": ["reply"], "statusMethods": ["status"] }
    ],
    "defaults": ["HeaderMap"],               // types the framework hands over when nothing narrower was written
    "validators": [{ "package": "my-checks", "methods": ["check"], "arg": 0 }]
  }
}
```

Only `name`, `appTypes` and whichever of the rest the framework actually uses
are needed; every other key above has a default and most frameworks leave most
of them out. `verbs` defaults to the eight a method is usually named after, so a
framework spelling `app.get('/orders', handler)` needs no verb table at all.

**This is the same description the four shipped frameworks are written in.**
Express, Fastify, Koa and Hono are rows of exactly this shape in
`packages/adapters-entry/src/route-dialects.ts`, validated by the same schema
and turned into a reader by the same function, so a description that reads a
repository correctly for one of them reads it correctly for yours. A field
nothing here uses would be a field only configuration had ever tested.

**What a request carries is described the same way** (P29). `request` says
where a handler finds the parts of a request and how it answers: each part as a
parameter and keys from it - `"text": true` where the part is text the handler
parses - or as a method handing it back, with `byArgument` mapping the string a
call passes first (`valid('json')`) to the part it stands for. An answer is a
method called on a parameter (`call`, with the methods in front of it that set
the status), a function the framework exports (`named`, with `statusArg` or
`statusKey` for the status beside it), an assignment to a parameter's key
(`assign`), or what the handler returns, at a key and as text where the
platform carries it so (`return`, with `statusAt`). What is found goes on the
route's `handles` edge under the keys a NestJS route has always had - `body`,
`params`, `query`, `headers`, and the answer as its `returns` - so the Graph tab,
`flow` and `contracts` read it the same way whatever framework declared the
route.

What counts, in order: a type the handler's parameter declares at that place; a
validator's output (`schema.parse(req.body)`, where `schema`'s `parse` is
declared by a package `validators` names - zod, valibot, yup and superstruct are
always listed); and a cast or an annotation (`req.body as CreateOrder`), which is
recorded under `meta.claimed` because nothing checks it. A framework's own
default - `any`, `unknown`, a dictionary of strings, a type `defaults` names - is
no type, and two different claims for one part are none either. A validator
that hands back a result rather than the value names where the value sits in it
(`"at": ["data"]` for zod's `safeParse`, which is listed). An answer sent with a
status of 400 or more is kept apart under `meta.failures` - a status written as
a number, or as a constant or enum member whose value the checker knows; one
whose status the code works out at run time could be either, and is kept under
`meta.statusUnknown`, neither the answer nor a failure. A Koa-style status
assigned beside the answer (`ctx.status = 404`) is read with `statusAt`. Path
params a handler reads that nothing types are named by the path as written -
`/orders/:id` gives `{ id: string }` - because every framework hands them over as
text. What middleware leaves for the handler, such as Express's `res.locals`, is
not part of what the caller sent and is not read. The shipped frameworks - Express,
Fastify, Koa, Hono, both Next.js routers, Medusa, and a Lambda behind an API
Gateway - are rows of this shape in
`packages/adapters-entry/src/request-readings.ts`.

**A description turns its own reader on.** Detection is offered the
configuration as well as the manifest, so `entry-http-custom` recognises a
repository when one of your descriptions is about it: the description names its
`packages`, the repository declares one of them, and it is read. Nothing needs
naming under `adapters.force.entry`. A description that names no `packages` is
tried everywhere, and so turns the reader on in every repository of the
project — which is what such a description says, since a framework with no
package to point at cannot be found any other way.

**A description that matched nothing is a row, not a quiet zero.** Silence is
the failure mode of every configuration-driven reader, because a repository
nothing was read from looks exactly like a repository with nothing in it. Four
rows say which part matched nothing: `entry-http-description-inactive` when none
of the description's `packages` is a dependency here (ordinary in a project of
several repositories, and `info`), `entry-http-types-unmatched` when nothing in
the repository is a value of any type it names, `entry-http-routes-unmatched`
when calls on those types were found and none of them spelled a verb and a path,
and `entry-http-routes-unplaced` when routes were read and only some of them
could be placed at an address.

**A partial read does not buy silence.** That last row is the one the other three
were missing, and it matters more than any of them: the question used to be
whether the count was zero, so a service where three routes were placed and
hundreds were not looked exactly like a service with three routes. Each of the
unplaced ones has a row of its own naming the application
whose base could not be read; this row is the sentence that says the addresses
recorded are a part of what the service serves rather than the whole of it, which
is the difference between a gap and a lie.

The same rows are written for a framework shipped with the tool, at `info`
rather than as something to act on. A repository that depends on Express and
declares no route on it is ordinary — a library, a worker, a service whose routes
live elsewhere — and it reads exactly like a repository whose routes are declared
in a way no reader here knows, such as a file-system router nobody has described.
The reader cannot tell those two apart; what it can do is say which two it cannot
tell apart, rather than counting the repository as clean.

### An answer built by a helper

Many codebases never call the framework's answering method in a handler: they
return what a helper of their own builds - `return respond(201, order)` in a
Lambda, `sendOk(res, order)` in an Express app - and parse bodies the same way.
The framework's description finds nothing there, and every route reads as
stating no answer. Say once, under `adapters.entry.request`, what those helpers
are, and they are read beside every framework's own places (P30):

```jsonc
"adapters": {
  "entry": {
    "request": {
      "answers": [
        // `return respond(201, order)`: the answer is argument 1, the status argument 0
        { "by": "helper", "name": "respond", "package": "@acme/http-kit", "statusArg": 0, "arg": 1 },
        // `sendOk(res, order)`: a helper of this repository that always answers 200
        { "by": "helper", "name": "sendOk", "arg": 1, "status": 200 },
        // `return fail(400, 'bad_input', message)`: a failure built from several arguments
        { "by": "helper", "name": "fail", "package": "@acme/http-kit", "statusArg": 0, "fields": { "code": 1, "message": 2 } }
      ],
      "helpers": [
        // `readJson<CreateOrder>(event)`: hands back the body, typed by what the call asks for
        { "name": "readJson", "package": "@acme/http-kit", "part": "body" }
      ]
    }
  }
}
```

A helper with a `package` is matched by the import in the handler's own file -
`import { respond } from '@acme/http-kit'`, under any local name, or
`kit.respond` on a namespace or default import of it, or a default import
called itself when `name` is `"default"` - or through a barrel of the
repository's that re-exports it from the package (`export { respond } from
'@acme/http-kit'`, `export *`), so the package does not have to be installed; one without is matched by a declaration of that name in
the repository, and a function of the same name declared anywhere else is not
it. An answer may sit in an object handed to the helper (`"at": ["body"]`), or
be built from several of its arguments: `"fields"` names each field of the
answer and the argument it comes from, so `fail(400, 'bad_input', message)`
answers `{ code: string; message: string }` under 400 - each field typed by
what is written at the call, a literal by its kind, and an argument whose type
says nothing left out (P33). A body helper's result is typed by a type argument written at the call, else by
what it is declared to return, and is recorded as claimed unless `"claim":
false` says the helper checks what it parses. `param` and `arg` say which of the
handler's parameters is the request and which argument of the helper it must
be handed, so a call on anything else is not read as one.

### Where a NestJS route's address comes from

The path recorded is the one the framework prints at start-up: the global prefix,
then the version where versioning puts one in the address, then the controller's
path and the route's own. So counting entries against that log, or pasting a path
out of the graph into a request, is meant to work.

Both of the things that decide it are looked for anywhere in the repository, not
only in the entry file. `app.setGlobalPrefix('api')` and
`app.enableVersioning({ … })` are routinely called from a helper that the
application's several workers and its tests share, and a service whose prefix was
read from the wrong file has every one of its addresses wrong by the same amount
— which is an address that cannot be joined to anything. Where two files disagree
about a prefix, none is used and a row says which values were found. Which
application is created is still read from `services[].bootstrap` and from nowhere
else: that question has one right answer per entry point, and searching for it
picks the wrong one silently.

Under `VersioningType.URI` the version is part of the address, so a route at
version `2` is recorded at `/api/v2/…`, a route that names none is recorded at
the application's `defaultVersion`, and `VERSION_NEUTRAL` is recorded with no
version segment at all. Under the header and media-type kinds one address serves
every version, so the version is recorded on the entry and changes no path. A
handler naming several versions is several addresses and therefore several
entries.

Where part of an address could not be read — a prefix assembled from a setting,
say — the part that could is kept and the rest is written as `${…}`, which
nothing matches. Such a route is in the graph and is never joined to a caller,
because an address nobody has seen in full is not an address. One row per site
says which line could not be read and what it costs; there is no row per route,
since a service has one prefix and four hundred copies of one sentence help
nobody.

### More than one framework in one repository

Nothing to configure. `services[].type` picks the reader that opens a
repository; which frameworks are inside it is decided per repository from its
manifest, and as many adapters as recognise it all run. A Nest application with
a worker declaring routes in front of it is one service with `type: "nestjs"`,
and both halves are read.

A route is a route whoever declared it, so a worker's `app.get(path, handler)`
becomes an ordinary `http` entry point with the path exactly as declared —
including a prefix written into the path, since nothing adds one to a route
declared outside the framework that has a global prefix. Middleware arguments
between the path and the handler are not mistaken for it. Where the same address
is declared on both sides, it is one entry point with two handlers, and
`flowatlas build` lists it under `routes.duplicated`: which of the two answers
depends on how they are wired together, and that cannot be read from either.

### What stands in front of a way in

A guard, an interceptor, a pipe and a piece of middleware are all the same fact
to the graph: a node of that kind (`guard`, `interceptor`, `pipe`,
`middleware`) joined to the entry by a `guarded_by` edge whose `meta.order` is
its position in the chain, in the order they run. NestJS's whole wrapping layer,
middleware installed with `use` on Express, Fastify, Koa and Hono (including on
an application above a mount), a tRPC procedure's `.use(...)` inherited through
the procedure it was built from, and the entries of Medusa's declarative
middleware list, ordered the way that framework runs them, are all drawn this
way, so the route audit, `impact`, `flow` and the settings walk see every one of
them (`fixtures/nest-guards`, `fixtures/express-service`,
`fixtures/trpc-router`, `fixtures/medusa-fs-router`). An entry also carries
`meta.middlewareRead`, whether its reader read everything that could stand in
front of it. Medusa's is `false`, because the framework's own authentication of
`/admin` and `/store` is not read, so the audit asks a person to look at such a
route rather than calling it unguarded. Middleware installed in a different file
from the routes it covers is left out rather than guessed at, because the order
it runs in is the order modules are evaluated in, and nothing here reads that.

A NestJS entry also says, in `meta.access`, what covers it and from where:
`guards: [{id, name, layer, where, via, file, line, skippedBy?}]` in the order
they run, where `where` is `global` (`useGlobalGuards`, or an `APP_GUARD`
provider in any module, including one spread in from an array declared
elsewhere or returned by the module's own `forRoot()`), `module` (middleware a
module's `configure()` installs), `controller` or `route`, and `via` says how
in words (`APP_GUARD in AuthModule.forRoot`, `@UseGuards on OrdersController`);
and `optOuts: [{decorator, key, public, skips, where}]` for the decorators on
the handler or its class that let a request past a check. The page's details
panel, `get_flow` (on each guard, and `optOuts` on the entry) and
`describe_for_prompt` all show it. A `providers:` list that cannot be followed
— a spread of a call — is a `module-providers-unread` row, since an
`APP_GUARD` among such providers is in front of every route and nothing could
see it.

### What a way in can fail with, and how its calls run

A NestJS entry carries `meta.fails`: what a request to it can end in, as
`[{status, exception, at, file, line, source, assumed?, declared?}]`, one row
per place, sorted by status. `source` is `throw` for an exception its handler
throws, or a service or helper it calls throws - the built-in HTTP exceptions,
`new HttpException(..., status)`, classes that extend them, and the project's
own error classes; `guard` for a guard's refusal; `pipe` for the
framework's pipes on the route or on a parameter (400); and `interceptor` for
what an interceptor gives in place of an error, or raises itself, written where
the interceptor writes it (below). A throw caught in the
same body is left out, and so is a rethrow; an entry that is not a request
keeps the exception and no status (`fixtures/nest-failures`).

What is listed is what the route can actually answer (`fixtures/nest-fails-accurate`):

- **Validation.** A `ValidationPipe` installed for the whole application
  (`useGlobalPipes`, `APP_PIPE`) or with `@UsePipes` adds its 400 only to a
  route whose handler takes a `@Body`, `@Query` or `@Param` whose declared type
  is a class. A primitive, a list, an interface, a type literal or a `Record`
  gives it nothing to validate. Any other pipe in front of a route adds what it
  refuses with only when the handler takes a value pipes are handed. A
  `Parse*Pipe` handed to a parameter keeps its 400.
- **Domain errors.** An error class of the project's own that states its
  status - `readonly status = 404`, `statusCode = HttpStatus.CONFLICT`, a
  getter `get status()`, a `getStatus()`, or what its constructor stores from
  `super(message, 409)` - is answered with that status where an exception
  filter in front of the route reads it off the exception
  (`exception.status`, `exception.getStatus()`, a destructure, with a `??`
  fallback or an `instanceof` test). Filters are read from `useGlobalFilters`,
  `APP_FILTER` providers and `@UseFilters` on the controller or the handler,
  asked handler first, then controller, then application, and matched by
  their `@Catch(...)` against the class and every class it extends. A filter
  that answers a fixed status (`response.status(400)`) answers everything it
  catches with that one.
- **Guards.** An installed guard refuses with 403, or with what the table
  knows for it (401 for passport's `AuthGuard`, 429 for the throttler). A
  guard written in the project adds the 403 only where its `canActivate` can
  answer anything but `true`: a `return false`, a value typed `boolean`, a
  body that can end without returning. One whose every answer is `true`, and
  which otherwise throws, adds only what it throws; one that extends
  `AuthGuard('jwt')` and leaves `canActivate` to it answers 401.
- **Assumed.** A status nothing on the path writes carries `assumed: true`: an
  error that is not one of the framework's (a plain `Error`, or a class whose
  own status no filter reads, with that status in `declared`), a chain of
  bases too long to follow, a status behind a filter whose answer cannot be
  read. Such a filter is a `fails-filter-unread` row at `info`. The page draws
  an assumed status as `500?`.

- **Interceptors.** An error the handler, the code it calls or a pipe raises
  passes the route's interceptors on its way out, before the filters: those
  of `useGlobalInterceptors` and `APP_INTERCEPTOR` providers, then the
  controller's `@UseInterceptors`, then the handler's, the handler's
  last-written first. A guard refuses before any of them runs, so its refusal
  passes none; what an interceptor throws itself passes those outside it. Each
  RxJS `catchError(...)` in an interceptor's `intercept` is read, branch by
  `instanceof` test (an `if`, or a conditional): `throwError(() => new X())`
  or a `throw new X()` in the callback gives `X` in place of the error, which
  the interceptors outside and then the filters answer
  (`source: 'interceptor'`); `throwError(() => err)` or `throw err` hands it
  on; `of(...)`, `from(...)` or `EMPTY` answers with a value, and the failure
  is gone. A `timeout(...)` raises a `TimeoutError` (or what its `with`
  gives) that the steps after it see, so the framework's documented
  `TimeoutInterceptor` adds a 408 to every route behind it. The framework's
  serializer, cache and upload interceptors hand errors on. An interceptor
  whose handling cannot be read - a callback that calls a helper or is a
  method, a `try`/`catch` or a promise's `.catch`, an installed interceptor
  of another package - leaves what passes it `assumed`, whatever a filter
  answers, and is a `fails-interceptor-unread` row at `info`
  (`fixtures/nest-fails-intercepted`). Only an HTTP entry is read through
  them, as through filters.

- **Through a helper.** `throw toHttpError(check)` names the helper as the
  exception and carries `via: 'helper'`, `chosenFrom: [{exception, status?,
  assumed?}]` (what its table can give, at most twelve, each through the
  filters) and `status` only when every choice agrees; where the helper's
  answer cannot be read, `family: 'auth'` says the throw refuses a check of
  who is asking (P90, see the route audit above).

`get_flow`, `describe_for_prompt`, the page and the search box all read it,
and all of them group it: each status and exception once, with how many places
raise it. A helper is shown with what it can choose, `toHttpError (401 | 403 |
423)`, and the search box finds it by any of those statuses.

A `calls` edge says how the call runs. Inside a `for`, `for…of`, `for…in`,
`while` or `do` body, or a function handed to `map`, `forEach`, `reduce` and the
like, it carries `meta.inLoop: {kind, line}`; inside the arguments of
`Promise.all`, `allSettled`, `race` or `any`, `meta.concurrent: true` and
`meta.together: {by, line}`. A call in the list a loop walks runs once and is
not in it, and neither is an arrow pushed from a loop to run later
(`fixtures/nest-query-loop`).

A loop that runs a query, cache call, request or publish once per item -
directly, or through a function it calls - is one `query-in-loop` row at the
loop's line, at level `info` (P89). `meta.reaches: [{id, type, words, via?}]`
names every leaf it reaches, nearest first, eight at most (`reachesCut` counts
the rest); `meta.waysIn` is how many ways in of the service reach the loop and
`meta.entries` the first three of them, and doctor, the MCP `search` and
`describe_for_prompt` and the page's Busiest view list the most-reached first.
`meta.severity` is `likely` (a finding) or `note`: a loop whose every leaf is a
conditional write - a filter naming a state besides the id
(`findOneAndUpdate({ _id, status: 'queued' }, …)`, TypeORM
`update({ id, status }, …)` or a manager's `update(Entity, { id, status }, …)`,
an SQL `UPDATE … AND col =` or `RETURNING`, whether handed to a driver, to
`knex.raw` or to TypeORM's `query`), or a
helper under `callShape.conditionalWrites` - or a send to one recipient (a
producer described with `perItem: true`, a request to a host under
`callShape.perItemHosts`) is per item on purpose, and a note.

A loop bounded on purpose writes no row; its edges keep
`meta.inLoop.bounded` and the repository's `stats.loopsBounded` counts it by
why, which `flowatlas stats` prints:

| `bounded` | The loop |
|---|---|
| `chunk` | steps by a constant above one (`i += BATCH_SIZE`), cuts `slice(i, i + N)` or `splice(0, N)`, or walks what `chunk`, `chunks`, `batches`, `inChunks`, `splitEvery` or a `callShape.boundedCalls` helper returns |
| `page` | `while (hasMore)`, `while (hasNext)`; hands its query `take`/`limit` with `skip`/`offset`/`page`; or `while (true)` that stops on an empty or short page |
| `cursor` | `while (cursor)`, `do … while (token)`; or hands its query `cursor`, `after`, `startAfter`, `NextToken`, `ContinuationToken`, `ExclusiveStartKey`, `LastEvaluatedKey` or `nextPageToken` |
| `retry` | counts to a constant (`attempt < MAX_ATTEMPTS`) and leaves on success, inside a `try` or after a check |
| `literal` | walks an array or object written out, a `const` bound to one, `Object.keys/values/entries` of one, or an enum |
| `batch-call` | reaches nothing but batch operations (`meta.batch` on the leaf: `insertMany`, `bulkWrite`, `createMany`, `bulkCreate`, an SQL `IN (`, `ANY(`, `UNNEST(` or multi-row `VALUES`, `SendMessageBatchCommand`, `PublishBatchCommand`, `PutEventsCommand`, `BatchWriteItemCommand`, `PutRecordsCommand`) |
| `migration` | is in a `migration`/`migrations` directory, a class implementing `MigrationInterface`, or a module exporting `up` and `down` |

A step of one, or one that is a parameter, is not a chunk; a `while (cond)`
with no cursor or page key is not a page (`fixtures/loops-worth-fixing`).

A method or function carries `meta.logs: [{level, text, at}]` for each line it
writes through a logger or the console: the level, and the message as a
template with each value replaced by the name of what holds it
(`'removed {count} drafts'`), never the value. A line with no words, such as
`logger.error(err)`, has a level and no `text`. A `@Cron` way in carries
`meta.timeZone` or `meta.utcOffset` beside its expression when the options name
one (`fixtures/nest-jobs-logs`).

### More than one application in one service

An address is only an address within one application. A NestJS repository that
creates an API and a worker with `NestFactory` in two entry files, or a
repository holding a second Next.js application under `examples/`, serves the
same path twice without anything being wrong. So the application is part of an
entry's identity — `entry:api@WorkerModule:http:GET:/health`,
`entry:shop@examples/blog:http:GET:/api/orders` — whenever a service has more
than one, and absent otherwise, so an ordinary service's ids do not change.
NestJS applications are found by walking the repository for `NestFactory`
rather than by following calls out of `src/main.ts`, since a worker's entry file
is one nothing imports; a controller belongs to the application whose root
module reaches the module declaring it (`fixtures/nest-two-applications`). A
file-system router's application is the directory in front of its router root,
and the one at the service root is `.` (`fixtures/next-nested-apps`).

A request records the application its file is written in, so a relative
`fetch('/api/orders')` written inside `examples/blog` reaches that
application's route and nothing else (`fixtures/next-caller-application`). A
request from outside every application — another service, rooted at a settings
key — is answered by whatever is deployed behind that key, which no source says,
so where two applications serve the address it is an
`ambiguous-route-application` row naming both.

### Functions and routes declared in Terraform

A repository of Lambda handlers has no decorator, no call on an application and
no routes directory: its handlers are plain exported functions, and the facts
that one of them is deployed under a name and that `POST /loans` lands on it are
written in Terraform. A service of type `lambda` is read from both. `init` and
`link` propose it for a repository whose manifest declares `@types/aws-lambda`,
`aws-lambda` or `@middy/core`, whose function directories each declare one, or
which holds Terraform that declares a function or a route — including a
repository of nothing but Terraform, which is still a service: it has routes and
no bodies.

**Every function is an `invoke` entry** under the name it is deployed with,
`entry:<service>:invoke:<name>`, and it `handles` to the export its handler
names: `index.createLoan` is `createLoan` exported from `index.ts` in the
directory the function is packaged from. That directory is read from the archive
the configuration builds (`filename = data.archive_file.x.output_path`, with its
`source_dir` or `source_file`), and a directory of compiled output is mapped
back to its source through the `outDir` and `rootDir` of the tsconfig that wrote
it, so a function packaged from `dist/returns` lands on `src/returns`. Where
nothing says what the package is built from — a zip a script makes, an object in
a bucket — the module is searched for by name, and the edge is `heuristic`
(`handlerFoundBy: "search"`) if exactly one source file of that name exports the
handler, and a row otherwise. A handler wrapped in a chain —
`middy(createLoan).use(jsonBodyParser())` — or by a wrapper lands on the function
it wraps, with the chain and the wrappers as middleware in front of it, in the
order they run. `flow invoke:<name>` starts from a function.

**A handler re-exported lands where it is declared.** `export { processReturns }
from './operations'` and `export * from './operations'` are followed to the
declaration they re-export, and so is an export that is a name for something
else: `export const processReturns = operations.processReturns` with
`import * as operations`, the same in brackets (`operations['processReturns']`),
or a `const` bound to another such name. The edge is `static`
(`fixtures/lambda-namespace-handlers`). The same reading of a name serves every
reader that follows one — a wrapper's argument, a factory, a constant — and only
a `const` is followed, because a name assigned twice holds whatever was assigned
last. A function whose handler could not be read is a row recorded against its
`invoke` entry, so a `flow` that reaches it counts it.

**A wrapper is a call handed exactly one function**, written in place, named, or
a name for what another wrapper built, wherever it sits among the arguments:
`traced('createLoan', createLoan)`, `withRetry({ attempts: 3 }, recordReturn)`
and `instrument(placeHold, { segment: 'holds' })` all land on the function, and
so do `middy(traced('renewLoan', renewLoan))` and `middy(createLoanLogic)` with
`const createLoanLogic = traced('createLoan', async (event) => …)`. How far the
landing is trusted follows what could be read of the wrapper:

- a wrapper this repository declares is read, and is one when its body visibly
  hands the function on — returns it, calls it from the function it builds with
  everything that function was called with, returns what it returns, or hands
  it to another wrapper and returns what that built. The edge is `static`. A
  function of the repository that only uses what it was handed — calls it with
  one piece of a request, or while it is being built — is a factory, not a
  wrapper, and lands nowhere;
- a wrapper from an installed package is read as far as its declarations go,
  and one whose types say it hands back a function is taken at its word:
  `static`;
- a wrapper from a package that is not installed cannot be read at all. The
  edge is `heuristic`, and the entry's `wrapperUnread` says which wrapper and
  why. A wrapper of this repository that hands the function to such a package is
  no surer than the package.

A wrapper called by another name is the wrapper it names: taken off a namespace
into a `const` (`const traced = tracing.traced`, `tracing['withRetry']`), a
name of such a name, imported under another name (`import { traced as t }`), or
re-exported by a barrel under one. Each is read through the same reading of a
name as a re-exported handler, so a factory called by another name is still a
factory and lands nowhere (`fixtures/lambda-wrapper-alias`).

A call handed two or more functions — `firstOf(fromCache, fromTable)` — is not a
wrapper of any of them, because which one runs is not in the call, and stays a
`function-handler-unread` row naming the call (`fixtures/lambda-wrapped-handlers`).
The Express, Fastify, Koa and Hono reader follows a route's handler by the same
rule. The file-system routers (Next.js, Medusa) read a verb exported as a
wrapper's value as that whole call, so where the function sits among the
arguments never mattered to them.

**Every route is an `http` entry onto the same handler.** A REST API's path is
built from its `aws_api_gateway_resource` tree, `{loanId}` read as a parameter
and `{proxy+}` as the rest of the path; an HTTP API's from the `route_key`. The
integration names the function by a reference (`invoke_arn`, `arn`, the ARN
written inside an invoke address, an alias), or by name through a `data`
block. An authoriser in front of the route (`authorization`,
`authorization_type`) is a guard, so `route-unguarded` sees it.

**An API created from an OpenAPI document** (`body` on `aws_api_gateway_rest_api`
or `aws_apigatewayv2_api`) is read from the document: each operation under
`paths` - and `x-amazon-apigateway-any-method`, as `ALL` - is a route, and its
`x-amazon-apigateway-integration` says what answers it, read exactly as an
integration resource is: a function by its ARN or invoke ARN, or SQS, SNS or
EventBridge integrated directly. The body may be `templatefile("openapi.yaml", {...})`,
`file()`, `jsonencode({...})` or a heredoc, in JSON or YAML. A template
variable that is a reference (`create_loan_arn = aws_lambda_function.create_loan.arn`)
stays the reference, so `uri: ${create_loan_arn}` and
`uri: arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${create_loan_arn}/invocations`
both name the function; a part the files do not settle - an account id - does not
matter to which function or queue is named. An operation's `security` (or the
document's) is a guard. Each route is placed on its line in the document. The
walk over the operations is the one a service declared by its OpenAPI document
is read with (`fixtures/lambda-terraform-openapi`). A body that is not read -
a path the files do not settle, text that is not JSON or YAML, no `paths` - is
one `api-body-unread` row.

**A WebSocket API** (`protocol_type = "WEBSOCKET"`) has no paths and no verbs:
each `aws_apigatewayv2_route` is a way in of its own, an `event` entry keyed
`websocket/<api>/<route key>` - `$connect`, `$disconnect`, `$default`, or the
value the route selection expression picks out of a message, `askLibrarian` -
that runs whatever its integration invokes, or publishes onto the queue or bus
it sends to. `meta.authorization` records an authoriser on `$connect`
(`fixtures/lambda-terraform-websocket`).

**Other ways a function is run** (`fixtures/lambda-terraform-other-ways-in`):

| Declared as | Read as |
|---|---|
| `aws_lambda_function_url` | an `http` entry `ALL /*` on the function, keyed `ALL:/*@<function>` (`:<qualifier>` after it where one is named) so two URLs stay apart; `AWS_IAM` authorisation is a guard |
| `aws_lb_listener_rule` (or a listener's `default_action`) forwarding to an `aws_lb_target_group` with `target_type = "lambda"` and its `aws_lb_target_group_attachment` | an `http` entry per `path_pattern` and `http_request_method` (`ALL /*` where none is given) on each function registered; `host_header` values are kept as `meta.hosts` |
| `aws_cognito_user_pool` with `lambda_config` | an `event` entry `cognito/<pool>/<trigger>` per step - `pre_sign_up`, `post_confirmation`, `custom_email_sender`... - on its function |
| `aws_iot_topic_rule` | an `event` entry `iot/<topic filter>`, the filter read out of `sql`, running its `lambda` action's function, publishing onto the queue or topic of each `sqs` and `sns` action, onto `kinesis/<stream>` for each `kinesis` action and `dynamodb/<table>` for each `dynamodb` and `dynamodbv2` action (reaching whatever that stream runs), and starting the state machine of each `step_functions` action as `StartExecution` does; an `error_action`'s action is drawn the same way with `when: "failure"` on what it draws, a workflow or a function named elsewhere included, whose edge the linker draws with it; any other action - `firehose`, `s3`, `republish`, `http`, `cloudwatch_logs` and the rest - is one `iot-action-not-read` row at `info` naming it |
| `aws_lambda_permission` for any other principal - `logs.amazonaws.com`, another account | one `invoker-not-read` row at `info`, naming the principal: the function is run by something not read, and is still not called unused |

**Base paths and stages.** A custom domain's `aws_api_gateway_base_path_mapping`
or `aws_apigatewayv2_api_mapping` puts its base path in front of every route of
the API it maps, because that is the address a caller writes:
`https://api.library.example/v1/items/42` calls `GET /items/{itemId}` of the API
mapped at `v1`, and is joined to it as `GET /v1/items/:param`. An API mapped at
two base paths has each route at both. The route records `basePath`, `domains`
and the `stages` it is reached through; an API nothing maps records the stages
it is deployed to (`aws_api_gateway_stage`, `aws_api_gateway_deployment`,
`aws_apigatewayv2_stage`) and puts none of them in front, because a caller
reaches a stage through its invoke URL, which already carries it. A point of an
API another repository publishes carries the base path too. A mapping whose API
or base path is not read is a `route-base-path-unread` row, and the routes of
that API are at an address nothing joins to (`fixtures/lambda-terraform-base-paths`).

**A shared API is joined across repositories.** A route that hangs from a
point of an API another repository owns — looked up through a parameter
(`data.aws_ssm_parameter.x.value`) or another state's output
(`data.terraform_remote_state.x.outputs.y`) — has the part of its path this
repository adds and the name of the point. The repository that writes that
point (an `aws_ssm_parameter` holding a resource's id, or an output of a root
module with a backend) publishes its path, and the linker joins the two by
name, the way a channel is joined, so the route has its full address:
`POST /v1/loans`. A route integrated with a function another repository deploys
is given that function's handler, joined on the deployed name. Nothing published
under that name, or two places for it, is a row and no join
(`fixtures/multi-repo-lambda`).

**What is evaluated, and what is not.** Variables (their defaults,
`terraform.tfvars`, `*.auto.tfvars`), locals, `path.module`, string templates,
references to other blocks and modules, and the functions that address things —
`format`, `lookup`, `merge`, `join`, `replace`, `file`, `templatefile`,
`jsonencode`, `jsondecode`, `try` and a few dozen more — are evaluated.
Anything else is unknown, never guessed at: a function name that does not
evaluate in full is an entry with no name (`${…}@<declaration>` in its id) and
a row saying what to set, never a name built from the parts that did. A
`count` or `for_each` over something the files settle is expanded; over
something they do not, it is one instance with its key unknown, and says so.
Nothing needs `terraform init` or state: only the checked-out files are read.
Configuration written as JSON (`*.tf.json`) is read into the same tree as the
native syntax, with a line on every block and argument: a string is a template
(`"${aws_lambda_function.x.arn}"` is the reference), a variable's `default` is
JSON as written, and `"//"` is a comment. A member is a block where the language
makes it one - `lifecycle`, `dynamic`, a backend - and an argument everywhere
else, which every reader accepts in place of a nested block
(`fixtures/lambda-terraform-json`).

**Environments.** Several `*.tfvars` files that give one name two values are
two environments, and the tool does not pick one:

```json
{ "name": "loans", "repo": "./loans", "type": "lambda", "infra": { "vars": ["infra/env/dev.tfvars"] } }
```

reads the deployment `dev` describes. Without `infra.vars`, a function whose
name depends on such a variable has no name and a `function-name-disputed` row
names the variable and the files.

**A module from elsewhere, described.** A local module (`source = "./modules/x"`)
is read with its inputs bound. One whose source is a registry or another
repository cannot be read, so what it declares is described, in the module's own
language, beside the broker and HTTP descriptions:

```jsonc
{
  "adapters": {
    "infra": {
      "modules": [
        {
          // the source as a call writes it; a pinned ?ref= is ignored, * matches anything
          "source": "git::https://git.example.com/platform/terraform-api-route.git",
          // defaults for inputs a call may leave out, as expressions
          "variables": { "authorization": "\"AWS_IAM\"" },
          // each resource it declares, by its address in the module,
          // each argument an expression over var.<input>
          "resources": {
            "aws_api_gateway_resource.this": {
              "rest_api_id": "var.rest_api_id",
              "parent_id": "var.parent_resource_id",
              "path_part": "var.path_part"
            },
            "aws_api_gateway_method.this": {
              "rest_api_id": "var.rest_api_id",
              "resource_id": "aws_api_gateway_resource.this.id",
              "http_method": "var.http_method",
              "authorization": "var.authorization"
            },
            "aws_api_gateway_integration.this": {
              "rest_api_id": "var.rest_api_id",
              "resource_id": "aws_api_gateway_resource.this.id",
              "http_method": "var.http_method",
              "uri": "var.lambda_invoke_arn"
            }
          },
          // which output is which attribute, for a caller that hands one on
          "outputs": { "resource_id": "aws_api_gateway_resource.this.id" }
        }
      ]
    }
  }
}
```

A string is an expression, so a literal is written with its quotes
(`"\"AWS_PROXY\""`); a number, `true`, `false` and `null` are themselves. A
resource may repeat with `count` or `for_each` and use `each` like any other, and
a description is read by exactly the code that reads a module whose source is
present. `terraform-aws-modules/lambda/aws`,
`terraform-aws-modules/apigateway-v2/aws` and
`terraform-aws-modules/step-functions/aws` ship described; a description with the
same source in the configuration is tried first. A remote module nothing
describes is one `infra-module-undescribed` row naming the module, its source
and the inputs it was given — at `info` unless one of those inputs looks like a
handler, a function or a route (`fixtures/lambda-terraform-modules`).

Terraform is one reader of the interface the adapter is written against; the
Serverless Framework, the CDK, SAM and plain CloudFormation are four more
(below), each into the same shape. SST and Architect are named when a repository is written for one
(`deployment-unread`), and read by none.

### Subscribers declared in Terraform

The publishing half of an AWS channel is a call in a handler; the receiving half
is in Terraform, and is read from there, onto the channel the publisher names in
the grammar above. The two meet on one node, across repositories, by name.

| Declared as | Read as |
|---|---|
| `aws_cloudwatch_event_rule` with an `event_pattern` (`jsonencode`, heredoc or a string), and each of its `aws_cloudwatch_event_target`s | a consumer of every `eventbridge/<bus>/<source>/<detail type>` the pattern selects, reaching the target |
| a rule with a `schedule_expression`, and `aws_scheduler_schedule` | a `cron` entry on its target, the entry keyed by the rule's or the schedule's name |
| `aws_lambda_event_source_mapping` from a queue | a consumer of `sqs/<queue>` reaching the function |
| the same from a DynamoDB table's stream or a Kinesis stream | an `event` entry, `dynamodb/<table>` or `kinesis/<stream>`, on the function, and a consumer of the channel of that name that `triggers` it: a write in code onto the table or the stream reaches the function through it; `filter_criteria` is on the edge and one `stream-filter-not-matched` row at `info` |
| `aws_dynamodb_table` with `stream_enabled = true` or a `stream_view_type`, and `aws_kinesis_stream` | the channel `dynamodb/<table>` or `kinesis/<stream>`, declared: a table write lands only on a declared one |
| `aws_sns_topic_subscription` with protocol `lambda` or `sqs` | a consumer of `sns/<topic>` reaching the function or the queue; any other protocol is read and not followed (`info`) |
| `redrive_policy` on `aws_sqs_queue`, and `aws_sqs_queue_redrive_policy` | a `triggers` edge from the queue to a publisher onto its dead-letter queue — not a reader, so a queue nothing reads is still one `dead` reports |
| `aws_lambda_function_event_invoke_config` with `destination_config` | a `triggers` edge from the function's `invoke` entry, `meta.when: "success"` or `"failure"`, to the destination function's entry or a publisher onto its queue, topic or bus; a destination function another service deploys, named by its ARN or name, is joined by the linker by the same `triggers` edge with the same `meta.when`; a result put on a bus is the event `eventbridge/<bus>/lambda/Lambda Function Invocation Result - Success` (or `- Failure`), which rules take by name; a configuration of a function this deployment does not create draws a `result` consumer in this service, `meta.resultOf: "invoke:<name>"`, which the linker joins from that function's `invoke` entry in whichever service declares it by a `triggers` edge with `meta.when`, or a `reference-not-found` row where none does (`fixtures/lambda-terraform-destinations`) |
| `destination_config.on_failure` on `aws_lambda_event_source_mapping` | the same, `when: "failure"`, from where the mapping's batches come in: the stream's `event` entry, or the queue's consumer |
| `aws_pipes_pipe` | a consumer of its source reaching its target; a bus target with `eventbridge_event_bus_parameters` publishes exactly that event |
| `aws_s3_bucket_notification`: each `lambda_function`, `queue` and `topic` block, with its `events`, `filter_prefix` and `filter_suffix` | a consumer of `s3/<bucket>` taking those events and keys, reaching the function, or a publisher onto `sqs/` or `sns/`; a block the files do not settle - a `dynamic` block over what is known only once deployed - is `bucket-notification-unread` |
| the same written as a list of objects: the JSON form (`.tf.json`), and `terraform-aws-modules/s3-bucket/aws//modules/notification`, whose `lambda_notifications`, `sqs_notifications` and `sns_notifications` are keyed by id and whose `eventbridge` is read as below | the same consumers |
| a bucket that keeps versions: `aws_s3_bucket_versioning` with `status` `Enabled` or `Suspended`, the bucket's older `versioning { enabled = true }`, or `terraform-aws-modules/s3-bucket/aws` with its `versioning` input set (`{ enabled = true }`, `{ status = "Enabled" }`, or `enabled = false`, which the module turns into `Suspended`) | each notification of it takes a `DeleteObject` or `DeleteObjects` that names no `VersionId` as `s3:ObjectRemoved:DeleteMarkerCreated`, the marker it leaves, and not as `s3:ObjectRemoved:Delete`; a delete that names a version, read or not, is `s3:ObjectRemoved:Delete` alone |
| the same with `eventbridge = true` | a consumer of `s3/<bucket>` per family of events a write fires, publishing onto `eventbridge/default/aws.s3/Object Created` and `.../Object Deleted`, where the default bus's rules take them as any event |
| an API Gateway integration with SQS (`arn:aws:apigateway:<region>:sqs:path/<account>/<queue>`, `sqs:action/SendMessage`), SNS (`sns:action/Publish`) or EventBridge (`events:action/PutEvents`, the HTTP API subtypes `SQS-SendMessage` and `EventBridge-PutEvents`) | the route is the way in and a publisher onto that channel: no function runs |

**A target** is reached by what it is. A function this deployment creates is
reached through its own `invoke` entry; a schedule or a stream runs it as an
entry onto its handler, the way a route in front of it does. A function or a
workflow deployed elsewhere is a reference by its deployed name, joined to the
one entry in any service that answers to it (`reference-not-found` where none
does). A queue, a topic or a bus is a publisher of its own onto that channel; a
rule that puts the events it takes on another bus forwards each under the same
source and detail type, where that bus's rules see them. A rule that names its
events exactly forwards those; one that takes them by a pattern forwards
whichever channels the pattern matches across the project, each put on the other
bus by the linker with the match's confidence and `forwardedFrom` on the edge, and
a rule on that bus matches them in turn (`fixtures/lambda-terraform-bus-forward`).
A table or a stream joins the same way: a handler's write onto `dynamodb/<table>`
reaches the mapping from the table's stream, which triggers the `event` entry
on the function it runs, so `flow` and `impact` follow Lambda A → table → stream
→ Lambda B, across repositories when the writer and the table are in two
(`fixtures/lambda-terraform-table-stream`). A declared stream something reads
and nothing configured writes is one `stream-no-writer` row at `info`. Each is named by a reference to what the
configuration declares or looks up, by an ARN or URL written out, or by a
template whose name part is written out — `"arn:aws:lambda:${var.region}:${local.account}:function:library-notify"`
names its function even though neither the region nor the account is known. A
queue, a topic or a bucket the block gives no name (or only a `name_prefix`) is
named by its address, `sqs/${…}@aws_sqs_queue.inbox`, because the provider
names it when it is created: what the configuration points at it by joins it,
`static`, and nothing outside can (`deployed-name-generated`, a note; P246).

**Matching an event to a rule.** A pattern is a filter, not a name. Where it
names `source` and `detail-type` exactly, every combination is a channel, and
the join is `static`. Anything else — `prefix`, `suffix`, `anything-but`,
`exists`, `wildcard`, `equals-ignore-case`, or a field the pattern leaves out —
is matched as written against every channel the project publishes, and the join
is `heuristic`, with the reason on the edge, which `--format json` shows:

```json
"edge": {
  "type": "consumes",
  "confidence": "heuristic",
  "because": ["source \"library.loans\" matches prefix \"library.\""],
  "notMatchedOn": ["detail"]
}
```

A filter on `detail`, on any other field, or a subscription's `filter_policy` and
a mapping's `filter_criteria`, is recorded (`notMatchedOn`) and not matched on.
An unnamed bus is `default` on both sides. A pattern that selects nothing any
configured service publishes is one `subscription-matches-nothing` row at `info`:
a rule for events from outside — another account, a partner, the platform — is a
way in with no producer, not a fault. So is a rule that names its events exactly
and has no publisher here: its channel is drawn with a consumer and no producer,
and `dead --kind channels` lists it.

**Values a function is deployed with.** Every variable of a function's
`environment` block is kept on its `invoke` entry, as written, as text where the
files settle it, and as the deployed thing it names (`aws_sqs_queue.returns.url`
names the queue `library-returns` though its URL is not known until the queue
exists). The linker asks, per function, which code that function's handler
reaches, and completes every address waiting on the environment from that
function's values: two functions that run one helper and set its queue
differently send to two queues, each edge saying for which function. A function
that runs the code and does not set the variable is an `environment-not-set` row
naming both; a value two variable files set differently is an
`environment-value-unread` row naming the files, and `services[].infra.vars`
chooses. Every settings key a function sets says where its value comes from on
the `reads_config` edge that reads it (`setBy`).

A variable no function that runs the code is deployed with, and that the code
writes no default for, is read from the files at the top of the repository, the
same ones and under the same rules as a base address: written once, the same
way everywhere, it completes the address, the edge is `heuristic` with
`fromFiles` naming the file, and an `environment-from-files` row at level `info`
stands where `environment-not-set` would have. A producer no deployed function
runs at all is completed the same way, from the files alone.

**A default the code writes beside the variable** —
`process.env.RETURNS_QUEUE_URL ?? '<url>'`, `|| DEFAULT_TOPIC` with a `const`,
`const { BUS = 'library' } = process.env` — is where the code sends from a
function deployed without the variable. The address still waits on the
deployment, and the deployment's value wins where it is set; a function that
does not set it sends to the default, read through the same URL and ARN forms,
instead of being an `environment-not-set` row. The edge's `defaults` names the
variables the code's default stood in for, beside the `variables` the
deployment set. A value the deployment sets and the files do not settle is
still a row: the default is not what runs there. A default that is not one
name — an empty string, a pattern, or one behind a second variable — is not
taken (`fixtures/sqs-environment-fallback`).

`terraform-aws-modules/eventbridge/aws`, `terraform-aws-modules/sqs/aws`,
`terraform-aws-modules/sns/aws`, `terraform-aws-modules/s3-bucket/aws` (its bucket and versioning) and
`terraform-aws-modules/s3-bucket/aws//modules/notification` ship described, beside the function and route
modules (`fixtures/eventbridge-terraform`, `fixtures/sqs-sns-terraform`,
`fixtures/multi-repo-events`).

### Functions declared with the Serverless Framework

A `serverless.yml`, `serverless.yaml`, `serverless.json`, `serverless.ts` or
`serverless.js` is read into exactly what the Terraform reader gives for the
same deployment: the functions, the routes, the subscribers, the streams and
the workflows, which the same adapter draws and the same linker joins (P57). A
repository may hold one service at its top or one per directory below it
(`services/orders/serverless.yml`); each is read, its handlers relative to its
own directory. `init` and `link` propose the `lambda` type for such a
repository. Nothing is run: no `serverless print`, no plugin, no account.

**Variables are resolved where the files settle them**, innermost first:
`${self:...}`, `${sls:stage}`, `${opt:<name>}` from `services[].infra.options`
or its fallback, `${env:NAME}` from `.env` and `.env.<stage>` where the service
loads them (`useDotenv`, or version 4), `${file(./x.yml):a.b}`,
`${param:name}` from `params.<stage>` then `params.default`, `${aws:region}` and
`${strToBool(...)}`. The stage is the option, else `provider.stage`, else the
framework's own `dev`; the region likewise, else `us-east-1`. A value read from
the deployed account - `${ssm:...}`, `${s3:...}`, `${aws:accountId}` - is
never read; a name that holds one is not a name, and the row names the
variable. `${cf:<stack>.<output>}` is another stack's output, joined where that
stack is read (see "Values shared between deployments"). An ARN whose account is unread still names its
resource.

```json
{ "name": "orders", "repo": "./orders", "type": "lambda", "infra": { "options": { "stage": "prod" } } }
```

**Functions** are named `name`, or `<service>-<stage>-<key>` as the framework
names them; `provider.environment` and the function's own `environment` are
its values, each a `!Ref` or `!GetAtt` naming the resource it is. A
`package.artifact` leaves the directory unread, and the handler is searched for
by name, `heuristic`, as for a zip Terraform does not build.

| Written as | Read as |
|---|---|
| `http: POST orders`, `http: { method, path, authorizer, private }` | a route of the REST API `provider.apiName`, or `<stage>-<service>` |
| `httpApi: 'GET /orders'`, `httpApi: '*'` | a route of the HTTP API `provider.httpApi.name`, or `<stage>-<service>`; `*` is `ALL /{proxy+}` |
| `url: true` | the function URL, `ALL /*` |
| `websocket: $connect`, `websocket: { route }` | a way in of `provider.websocketsApiName`, or `<stage>-<service>-websockets` |
| `sqs`, `stream` | a mapping from the queue, the table's stream or the Kinesis stream the ARN, `!GetAtt` or `!Ref` names; `filterPatterns` recorded, not matched |
| `sns: <name>`, `sns: { arn, topicName, filterPolicy }` | a subscription; a name that is not an ARN is a topic the framework creates |
| `schedule: rate(...)`, `schedule: { rate: [...], name }` | a schedule per expression, its entry keyed by `name` |
| `eventBridge: { eventBus, pattern }`, `cloudwatchEvent` | a rule on the bus, the default one where none is named |
| `s3: <bucket>`, `s3: { bucket, event, rules }` | a notification of the bucket, its prefix and suffix |
| `cognitoUserPool: { pool, trigger }` | `cognito/<pool>/<trigger>`, the trigger spelled as Terraform spells it |
| `destinations: { onSuccess, onFailure }` | what a run ends in, onto a function by its key, a queue, a topic or a bus |
| any other event: `alb`, `iot`, `kafka`, ... | an `invoker-not-read` row at `info` |

`resources.Resources` is read as CloudFormation: queues and their
`RedrivePolicy`, topics and subscriptions, tables and their
`StreamSpecification`, Kinesis streams, buses, rules and their `Targets`,
buckets and their `NotificationConfiguration`, mappings and state machines.
`Ref`, `Fn::GetAtt`, `Fn::Sub` and `Fn::Join` are followed to what they name,
the framework's own logical ids (`PlaceDashorderLambdaFunction`) included;
`Fn::ImportValue` is another stack's output, joined where that stack is read. **A resource with no physical
name** is named by its declaration - `sqs/${…}@resources.Resources.NoticesQueue`
- because CloudFormation names it when the stack is created: everything in the
service that points at it spells it that way and joins, `static`, and nothing
outside can (`deployed-name-generated`, a note).

The `serverless-step-functions` plugin's `stepFunctions.stateMachines` are
workflows: the definition is the file's own value, each state drawn at its
line, and `Fn::GetAtt` of a function by its key or its logical id fills the
step that invokes it. Their `schedule` and `eventBridge` events start them; an
`http` event is a `route-target-unread` row, as a route onto a workflow is in
Terraform. Another plugin's section that declares functions or queues
(`constructs`) is a `deployment-plugin-unread` row (`fixtures/serverless-orders`,
`fixtures/serverless-shapes`).

### Functions declared in an AWS CDK app

A CDK app in TypeScript is read the way it runs, without running it: from the
entry its `cdk.json` names (`npx ts-node bin/app.ts`), statement by statement,
with `this` the construct being built, each construct of the app's own made
with what it is handed, helpers called with their arguments, constants and
imports followed across files, `for ... of`, `.forEach` and `.map` over a list
the files settle taken once per element, and an `if` the files settle decided
(P57). `aws-cdk-lib` need not be installed: what a construct is comes from the
module it is imported from - `aws-cdk-lib/aws-lambda`, `{ aws_lambda as
lambda } from 'aws-cdk-lib'`, version 1's `@aws-cdk/aws-lambda`, the `-alpha`
modules. `cdk.json`'s `context` answers `tryGetContext`, under
`services[].infra.options` (what `--context stage=prod` would be). Every
construct's address is its path in the tree (`OrdersStack/Api/Rest`), and a
construct a helper of the same file makes is placed at the helper's call.

| Written as | Read as |
|---|---|
| `new lambda.Function(...)` | a function: `functionName`, the handler in the directory `Code.fromAsset` names (compiled output mapped back to its source), `runtime`, `environment` and `addEnvironment` |
| `new NodejsFunction(...)` | its `entry` and `handler`, or the construct's default, `<file>.<id>.ts` beside the file that makes it |
| `Function.fromFunctionName`, `Queue.fromQueueArn`, ... | a construct named, joined wherever it is deployed |
| `RestApi`, `LambdaRestApi` | routes by the resource tree, `root.addResource(...).addMethod(verb, new LambdaIntegration(fn))`, `addProxy`, `proxy: true`; the API named `restApiName`, else its id, as the CDK names it; `authorizer` and `authorizationType` as guards |
| `HttpApi.addRoutes`, `new HttpRoute`, `WebSocketApi` | HTTP routes, and socket routes from `connectRouteOptions`, `disconnectRouteOptions`, `defaultRouteOptions` and `addRoute` |
| `fn.addFunctionUrl()`, `new FunctionUrl` | the function URL |
| `addEventSource(new SqsEventSource(q))`, `SnsEventSource`, `DynamoEventSource`, `KinesisEventSource`, `S3EventSource`, `new EventSourceMapping` | mappings, subscriptions and notifications onto the function |
| `topic.addSubscription(new LambdaSubscription(fn))`, `SqsSubscription` | subscriptions |
| `new events.Rule({ eventPattern, schedule, targets })`, `addTarget` | rules, the pattern's `detailType` as `detail-type` and `Match.prefix(...)` as a content filter; `Schedule.cron({ hour: '2' })` is `cron(* 2 * * ? *)` as the CDK writes it |
| `new scheduler.Schedule({ schedule, target })` | a schedule onto its target |
| `deadLetterQueue: { queue }` | a redrive |
| `bucket.addEventNotification(...)`, `eventBridgeEnabled` | notifications, and the bucket's events on the default bus |
| `Table({ stream })`, `TableV2({ dynamoStream })`, `kinesis.Stream` | streams a write in code publishes onto |
| `UserPool({ lambdaTriggers })`, `addTrigger` | `cognito/<pool>/<trigger>` |
| `onSuccess`, `onFailure` | what a run ends in |
| `new sfn.StateMachine({ definitionBody })` | a workflow: a chain of `Pass`, `Wait`, `Choice`, `Parallel`, `Map`, `Succeed`, `Fail` and the tasks (`LambdaInvoke`, `SqsSendMessage`, `SnsPublish`, `EventBridgePutEvents`, `StepFunctionsStartExecution`, `Dynamo*`, `CallAwsService`) written out as the States Language the CDK synthesises; `DefinitionBody.fromFile` with `definitionSubstitutions`; `fromString` |

**A construct with no name of its own** - a queue with no `queueName`, a
function with no `functionName` - is named by its path,
`sqs/${…}@OrdersStack.Inbox`: the function that sends to it through
`environment: { INBOX_URL: inbox.queueUrl }`, the mapping that reads it and the
step that sends to it all spell it that way and join, `static`
(`deployed-name-generated`, a note). **What the files do not settle is a row**:
a construct per element of a list read at run time is read once
(`construct-repeated-unread`; a function's is `function-repeated-unread`); one
under a condition the files do not settle is read and what reaches it drawn
`heuristic` (`construct-conditional`); a stack the app declares and never makes
is `construct-unreached`; a token the deployment fills in - `Aws.ACCOUNT_ID`,
`Fn.importValue`, a parameter looked up - is unread where a value needs it; a
construct of a module nothing reads that is handed a function is
`invoker-not-read`; and a `cdk.json` whose app is not a TypeScript file of the
repository is `deployment-app-unread`, with every stack read on its own and what
it is handed unread (`fixtures/cdk-orders`, `fixtures/cdk-shapes`).

### Functions declared in an AWS SAM template

A template written for the `AWS::Serverless-2016-10-31` transform - a
`template.yaml`, the one `samconfig.toml`'s `template_file` names, or any YAML
or JSON file of the repository that is a template naming the transform (see
"which files are templates" below) - is read into what the Terraform reader
gives for the same deployment (P246). Nothing is run: no `sam build`, no
transform, no account; `.aws-sam` is the CLI's own output and is not read.
`init` and `link` propose the `lambda` type.

**What a template is deployed with** is read from the `samconfig.toml` (or
`samconfig.yaml`) that deploys it - the one beside a `template.yaml`, or the
one in its directory or above whose `template_file` names it: the stack's `stack_name` and `region`, and each
parameter's value from `parameter_overrides`, `deploy` over `global`, in the
environment `services[].infra.options.config_env` names, else `default`. Any
other option is a parameter's value (`--parameter-overrides` written down), and
`stack_name` and `region` override the file's:

```json
{ "name": "library", "repo": "./library", "type": "lambda", "infra": { "options": { "config_env": "prod", "Owner": "desk" } } }
```

A parameter takes that value, else its `Default`; one with neither is unread,
and every name or value built from it says which parameter it waits on. Then,
before anything is read: `Conditions` are decided (`Fn::Equals`, `Fn::And`,
`Fn::Or`, `Fn::Not`, the pseudo parameters `samconfig` settles), `Fn::If` takes
its branch, `Fn::FindInMap`, `Fn::Select`, `Fn::Split` and `Fn::Join` of text
are worked out, `!Ref AWS::NoValue` removes its property, `Fn::ForEach` (the
language extensions) is written out once per element, and `Globals` is merged
under each function, API and state machine as the transform merges it. A
resource whose condition is settled false is not read; one under a condition
nothing settles is read, and what reaches it is drawn `heuristic`
(`construct-conditional`, a note).

**Functions** - `AWS::Serverless::Function` and a plain `AWS::Lambda::Function`
- are named `FunctionName`, or by their declaration where the platform names
them (`invoke:${…}@Resources.LendFunction`, `deployed-name-generated`). The
handler is the module `Handler` names in the directory `CodeUri` names (or
`Code`, a local directory); built with esbuild (`Metadata.BuildMethod`), the
entry point whose name the handler's module has is the source. An image, inline
code and a runtime other than Node.js are rows.

| Written as | Read as |
|---|---|
| `Api`, `HttpApi` events | a route of the API `RestApiId` / `ApiId` points at, named `Name`; with none, the API the transform makes, named after the stack; `Auth.Authorizer`, `Auth.ApiKeyRequired` and the API's `DefaultAuthorizer` as guards; an `HttpApi` event with no path is `ALL /{proxy+}` |
| `FunctionUrlConfig`, `AWS::Lambda::Url` | the function URL, `ALL /*`; `!GetAtt <Function>Url.FunctionUrl` handed to code names it, so a `fetch` of it joins the function (P54) |
| `SQS`, `DynamoDB`, `Kinesis` events | a mapping from the queue, the table's stream or the stream; `FilterCriteria` recorded, not matched; `DestinationConfig.OnFailure` where its batches go |
| `SNS` | a subscription; `SqsSubscription` recorded |
| `S3` | a notification of a bucket of the template, its `Filter` rules |
| `Schedule`, `ScheduleV2`, `AWS::Scheduler::Schedule` | a schedule, its entry keyed by `Name` |
| `EventBridgeRule`, `CloudWatchEvent` | a rule on `EventBusName`, the default bus where none is named |
| `Cognito`, a user pool's `LambdaConfig` | `cognito/<pool>/<trigger>` |
| `IoTRule` | `iot/<topic filter>`, as Terraform spells it |
| `EventInvokeConfig`, `DeadLetterQueue`, `AWS::Lambda::EventInvokeConfig` | what a run ends in |
| any other event: `CloudWatchLogs`, `MSK`, `MQ`, ... | an `invoker-not-read` row at `info` |

**APIs written on their own** are read too: the OpenAPI body of an
`AWS::Serverless::Api` or `HttpApi` - in place, through `AWS::Include`, or a
`DefinitionUri` file of the repository - each path whose integration URI holds
the ARN of a function of the template; an HTTP or WebSocket API written as
`AWS::ApiGatewayV2` routes and integrations, or made in one resource with
`Target` (the `$default` route, or the `RouteKey` it names, onto that function,
P248); and a REST API written as `AWS::ApiGateway` resources and methods, its
path built up from `ParentId`, `AuthorizationType` and `ApiKeyRequired` its
guards.

**State machines** (`AWS::Serverless::StateMachine`) are workflows: a
`Definition` written in place, each state drawn at its line, or a
`DefinitionUri` file read as Terraform reads a rendered template, every
`${...}` answered from `DefinitionSubstitutions`; a step naming a function with
`!GetAtt` or through a substitution invokes it. Their `Schedule`, `ScheduleV2`,
`EventBridgeRule` and `CloudWatchEvent` events start them; an `Api` event is a
`route-target-unread` row. Everything else is read as CloudFormation, by the
same table the Serverless Framework's `resources.Resources` is read through.

**A nested application** (`AWS::Serverless::Application`, or
`AWS::CloudFormation::Stack`) whose `Location` is a template of the repository
is read in place, under the parameters handed to it - a queue's `!Ref` handed
down is the queue - its addresses under the application's logical id
(`Notices.Resources.SenderFunction`), and `!GetAtt Notices.Outputs.X` is what
its output names. One published elsewhere is `nested-deployment-unread`. A
layer is a `layer-not-followed` note, a macro the template names in
`Transform` other than the language extensions is `deployment-plugin-unread`,
and a loop over a collection nothing settles is `construct-repeated-unread`
(`fixtures/sam-orders`, `fixtures/sam-shapes`).

### Functions declared in a plain CloudFormation template

A CloudFormation template with no SAM transform is read by the same code as a
SAM template, as a reader of its own (`cloudformation`, in `meta.deployedBy`):
it is a SAM template with none of the transform's types, no `Globals` and no
API made for events, so everything above that is plain CloudFormation reads
the same - parameters, conditions, mappings, `Fn::If`, `Fn::ForEach`, functions
(`AWS::Lambda::Function`, its code in the local directory `Code` names for
`aws cloudformation package`), mappings, URLs, destinations, APIs written as
resources or as an OpenAPI `Body`, rules, schedules, subscriptions, bucket
notifications, user pools, state machines and nested stacks (P248). `init` and
`link` propose the `lambda` type.

**Which files are templates.** Any `.yaml`, `.yml`, `.json` or `.template`
file of the repository, to four directories down, that says it is one: an
`AWSTemplateFormatVersion`, or a `Resources` map with an `AWS::` type in it. A
template that names the SAM transform is SAM's; any other is this reader's.
Not read as templates of their own:

| Left out | Because |
|---|---|
| `node_modules`, `dist`, `build`, `coverage`, `__snapshots__`, any directory starting with `.` (`.aws-sam`, `.serverless`) | installs and build output |
| a template another nests (`AWS::CloudFormation::Stack`'s `TemplateURL`, a SAM application's `Location`) | read in place through its parent |
| the copy `aws cloudformation package` or `sam package` writes of a template | the same resources as a template of the repository, its local paths swapped for uploads |
| a file a Serverless Framework service loads into its `resources` (`${file(...)}`) | the Serverless reader's |
| `cdk.out` beside a `cdk.json` | the templates `cdk synth` writes for an app the CDK reader reads itself; a `cdk.out` with no app beside it is read |

**What a template is deployed with**: the `samconfig.toml` that names it in
`template_file`, as `sam deploy` deploys a plain template too; otherwise
`services[].infra.options`, each option a parameter's value as
`aws cloudformation deploy --parameter-overrides` takes them, and `stack_name`
and `region` the pseudo parameters:

```json
{ "name": "orders", "repo": "./orders", "type": "lambda", "infra": { "options": { "Stage": "dev", "region": "eu-west-1" } } }
```

Each template's addresses are under its file (`stacks/orders.Resources.PlaceOrderFunction`),
since a repository often keeps several in one directory. A `.template` file is
JSON where it opens with a brace and YAML otherwise; `DefinitionS3Location` and
`BodyS3Location` naming a file of the repository are read like SAM's
`DefinitionUri` (one in a bucket is `workflow-definition-not-loaded` /
`api-body-unread`). An `AWS::Lambda::Permission` for a principal no reader
follows (`logs.amazonaws.com`, an account) is an `invoker-not-read` note, as
Terraform's is; the permission behind a function URL, or for a service whose
invocations are read from the resources that make them, adds nothing. An
`AWS::Serverless::*` type or `Globals` in a template that names no transform is
`deployment-plugin-unread`, and none of it is read.

**Stacks of one repository import from one another.** An output with
`Export.Name` in one template - SAM or plain - is what `Fn::ImportValue` of
that name in another is, read as statically as a `Ref`: the queue the storage
stack declares is the queue a mapping in the functions stack reads and the
queue a handler sends to through an imported environment value, by its name or
its stand-in. Every template is read for its exports until a reading adds
none, so an export of an import is settled too. An import two templates of
the repository export is an unread value saying so; one no template of the
repository exports is looked for in the other repositories' deployments, as
the next section says (`fixtures/cloudformation-orders`, where the deployment
of `terraform-orders` is two stacks joined by their exports and reads as the
same graph; `fixtures/cloudformation-shapes`).

### Values shared between deployments

Repositories deployed with CloudFormation - a Serverless service, an AWS SAM
template, an AWS CDK app - share what they create by writing it out as an
**output**, and read it back in another stack (P249). Both halves are read, and
the linker joins them on the name both write, as it joins a route to a shared
Terraform root above:

| Published as | Read back as | Key |
|---|---|---|
| an output with `Export.Name` (`resources.Outputs` of a service, `Outputs` of a template, `new CfnOutput(this, id, { exportName })`) | `Fn::ImportValue: <name>`, `!ImportValue <name>`, `Fn.importValue('<name>')` | `export:<name>` |
| any output of a stack whose name the files settle (`<service>-<stage>` or `provider.stackName`, `samconfig.toml`'s `stack_name`, a CDK stack's `stackName` or id, for an output that is a direct child of the stack) | `${cf:<stack>.<output>}`, `${cf(<region>):<stack>.<output>}` | `stack:<stack>#<output>` |

The framework's own outputs are published too, where it creates the API they
describe: `ServiceEndpoint` (exported as `sls-<service>-<stage>-ServiceEndpoint`),
`HttpApiId` and `HttpApiUrl`.

**What an output names** is read as any value is: a queue, a topic, a bus, a
table, a function, a function's URL - or an API. An output that is a REST API's
id or its root (`!Ref ApiGatewayRestApi`, `!GetAtt Api.RootResourceId`,
`api.restApiId`, `api.restApiRootResourceId`), an HTTP API's id
(`!Ref HttpApi`, `httpApi.apiId`) or a REST resource of the stack
(`!Ref V1Resource`, `resource.resourceId`) is also a **point of the API** other
repositories hang routes from; its URL (`!Sub https://${ApiGatewayRestApi}...`,
`api.url`) is its address.

**Routes on an API another repository creates.** A Serverless service whose
`provider.apiGateway.restApiId` (or `provider.httpApi.id`) is such an import, a
CDK app that looks the API up with
`RestApi.fromRestApiAttributes(this, id, { restApiId, rootResourceId })` or
`HttpApi.fromHttpApiAttributes(this, id, { httpApiId })`, and a SAM template
whose `AWS::ApiGateway::Resource` `ParentId` (or a `Method`'s `ResourceId`) or
`AWS::ApiGatewayV2::Route` `ApiId` imports one, hang their routes from that
point. The linker gives each its full path, and the route is a route of the
publishing service as well as its own: a client whose base address is the
publisher - by `baseUrlEnv`, by a host, or by an imported API address in the
environment it is deployed with - lands on the handler in the repository that
holds it. An API id written as anything else (a literal id, a parameter of the
account) draws no route and is a `route-path-unread` row; so is a SAM `Api`
event whose `RestApiId` is imported, which the transform refuses.

**Queues, topics and values of the environment.** An `sqs`, `sns`, `stream` or
`eventBridge` event, a SAM `SQS`, `SNS`, `DynamoDB`, `Kinesis` or
`EventBridgeRule` event, and a CDK construct looked up by an import
(`Queue.fromQueueArn(this, 'Q', Fn.importValue('orders-placed-arn'))`) read the
thing the import names, drawn under a stand-in for its key
(`sqs/${…}@import.export.orders-placed-arn`) that the linker renames to what the
publisher says it is, before the repositories are merged: the producer's queue
and its importer's are one channel. A value of the environment that is an
import is given what the output names, so a publish through it lands on the
channel and a request through an imported API address joins that API's routes.

| Situation | Row |
|---|---|
| no configured service publishes the key | `export-not-found`, at the import |
| two services publish it | `export-ambiguous` |
| its value is not read, or is not the kind of thing the import reads (a topic where a queue is read) | `export-mismatched` |
| a route hangs from a point no configured service publishes | `route-root-not-found` |

(`fixtures/multi-repo-exports`: a Serverless gateway, a CDK orders app and a SAM
catalog over one REST API and one HTTP API, a queue and a topic each side reads
of the other, and an import nobody publishes.)

**A `serverless-compose.yml`** (`.yaml`, `.json`, `.ts`, `.js`) is read as one
deployment of the services it lists: each `services.<key>` with its `path` (and
`config`) is read as a service of the repository, with the compose file's
`params` given to its `${param:...}` ahead of the file's own `params`, and a
param `${<service>.<Output>}` is the output of that service's stack, joined as
any import is. A service file a compose file lists is not read again on its
own, and its functions carry `meta.composedAs`. A service whose folder is
outside the repository, missing, or holds no service file is a
`compose-service-unread` row (`fixtures/serverless-compose`).

#### Parameters of the account, an app's own stacks, and imports whose kind the use does not say

**A parameter of the account** one deployment writes and another reads by name
is joined as an output is (P253), whatever each is written with, under the key
Terraform's shared roots already use:

| Written as | Read back as | Key |
|---|---|---|
| `AWS::SSM::Parameter` with a `Name` (a Serverless service's `resources`, a SAM or plain template), `new ssm.StringParameter(this, id, { parameterName, stringValue })`, Terraform's `resource "aws_ssm_parameter"` | `{{resolve:ssm:<name>}}` (a version after it or not), a template parameter typed `AWS::SSM::Parameter::Value<String>`, `${ssm:<name>}` (`${ssm(<region>):...}`, `~true`), `StringParameter.valueForStringParameter(this, '<name>')`, `valueFromLookup`, `fromStringParameterName(...).stringValue`, Terraform's `data "aws_ssm_parameter"` `.value` | `parameter:<name>` |

A parameter whose value is a point of an API is published as one, so a route
hung from `{{resolve:ssm:/shop/api/root}}` joins a Terraform `aws_ssm_parameter`
holding `root_resource_id`, and the other way round. A Serverless service that
names `provider.apiGateway.restApiRootResourceId` hangs its routes from that
point rather than from `restApiId`. A parameter two templates of one repository
write and read is the value itself, as an in-repository export is. A secure
parameter and a secret (`{{resolve:ssm-secure:...}}`, `secretsmanager`) are not
read. A parameter nobody configured writes is an `export-not-found` row naming
it.

**An app's own stacks.** A construct one stack of a CDK app hands another is
the same construct; an output the app exports (`new CfnOutput(..., { exportName })`,
`stack.exportValue(value, { name })`) or a parameter it writes, read back by
another of its stacks (`Fn.importValue`, `valueForStringParameter`), is the
value itself, with no import left for the linker. `exportValue` is published
under its export name for other repositories.

**Parameter files.** A template's parameters are given values from a parameter
file - a list of `ParameterKey` / `ParameterValue`, a list of `Key=Value`, or a
pipeline's template configuration `{ "Parameters": {...} }` - where
`services[].infra.vars` names one (every template takes it), where its
`samconfig` names one (`parameter_overrides = "file://params.json"`), or where
one sits beside it under a name that says so: `<template>.parameters.json`,
`-parameters.json`, `.params.json`, `-params.json`, `.config.json`,
`-config.json`, `-configuration.json`, and, for a template alone in its
folder, `parameters.json`, `params.json`, `template-config.json`,
`template-configuration.json`. Two beside one template are a
`parameter-file-ambiguous` row, and neither is read. The options win over
every file, the configuration's files over the `samconfig`'s overrides, those
over a file beside the template.

**Imports whose kind the use does not say.** A mapping's `EventSourceArn`, a
function's `DestinationConfig` (and a mapping's failure destination, a
dead-letter target with no `Type`), the same in Terraform and the CDK, read a
value another deployment publishes without saying whether it is a queue, a
stream, a table's changes, a topic, a bus or a function. A mapping with no
starting position reads a queue; any other such use is read once per kind it
may be, each under its own address, and the linker keeps the reading the
publisher's value is - under the address it was written at - and drops the
others with what only they drew. Nothing is drawn for an import nothing
publishes. An ARN or an address built around an import
(`!Sub https://sqs.${AWS::Region}.amazonaws.com/${AWS::AccountId}/${QueueName}`,
`arn:aws:sqs:...:${ssm:/shop/queue-name}`) names the thing of the kind the
text says, by the import's stand-in; the publisher's value - the thing, or its
name as text - finishes it.

**A value published under a generated name.** A queue or a topic with no name
of its own is named by where it is declared; where another repository imports
it, the name is given the publishing repository's
(`sns/${…}@catalog@stacks.catalog.Resources.Topic`) in both graphs, so the
importer meets the producer's channel and no other repository's that happens
to declare something unnamed at the same address
(`fixtures/multi-repo-parameters`).

#### The tools a template is deployed with, rule targets and endpoints of an import, and names built of several

**Parameter files in YAML.** The three documents a parameter file is - a list
of `ParameterKey` / `ParameterValue`, a list of `Key=Value`, a template
configuration `Parameters:` - are read written as YAML too (P259), under the
same names with `.yaml` or `.yml` (`<template>.parameters.yaml`, ...), from
`services[].infra.vars` and from a `samconfig`'s `file://`. A document whose
`Parameters` are objects of a type and a default is a template, not a file of
values.

**sceptre.** A template under a project's `templates/` is read with the values
of the stack configuration that names it (`config/<group>/<stack>.yaml`,
`template_path` or `template: { path }`): its `parameters`, its `stack_name` or
else the project's `project_code` and the stack's path joined by `-`
(`shop-prod-platform`), and the `region` the nearest group `config.yaml`
gives. A resolver (`!file_contents`, any `!tag` not read below) and a Jinja
expression this does not render are values not known from the files - never
the parameter's default (`!stack_output`, `!environment_variable` and Jinja
over literal values are read since P261, below). Several stacks naming one template are several environments: the
one `services[].infra.vars` names by its file, or the group
`services[].infra.options.config_env` names, is read; otherwise a
`parameter-file-ambiguous` row names them and none is.

**rain.** A `rain deploy <template> [<stack>]` written in a `package.json`
script or a Makefile recipe beside the template or above it gives the template
its `--params K=V,...` over the values of its `--config` file (a template
configuration, JSON or YAML), its stack the name it writes or the template's
own, and its region `--region`. A shell variable on the command is a value not
known. Two commands with different values are a `parameter-file-ambiguous` row.

Precedence, highest first: the options; the configuration's files; a
`samconfig`'s inline overrides; the files its `parameter_overrides` names, else
a sceptre stack or a rain command, else a file beside the template; the
`Default`. Every file read is stamped for the build cache.

**Rule targets and subscription endpoints of an import.** A rule's or a
schedule's target (`Targets[].Arn: !ImportValue ...`,
`aws_cloudwatch_event_target.arn = data.aws_ssm_parameter...value`) is read
once per kind it may be - a function, a queue, a topic, a bus or a workflow -
and the linker keeps the one the publisher's value is, as it does for a
mapping or a destination (P253). A subscription's endpoint, a bucket
notification's target and a dead-letter queue are of the kind their protocol
or their property says, and are read as that one. A Terraform mapping read as
alternatives draws its failure destination once per reading, kept and dropped
with it; a destination that is itself an import is read once per kind under
each reading (P261, below).

**Names built of several imports.** An address with two imports or more written
into it (`!Sub` with `!ImportValue` variables, `!Join`, a Serverless string with
`${cf:...}` and `${ssm:...}`) reads each one: an import outside the name - the
account - does not change which thing it is, and a name built of imports and
text (`${Prefix}-orders-audit`) is written by the linker, part by part, where
every part is joined; where one is not, the name is kept whole and the part is
an `export-not-found` row (`fixtures/multi-repo-shared-values`).

#### Two values in one string in the CDK and Terraform, a choice inside a choice, and what sceptre and rain are run with

**The CDK and Terraform read a string part by part too (P261).** In a CDK app,
a template literal, a `+`, `Fn.sub(text, { Name: value })` and
`Fn.join(separator, [...])` with `Fn.importValue(...)` or
`StringParameter.valueForStringParameter(...)` among their parts are read as a
CloudFormation `!Sub` is: `this.region`, `this.account` and a pseudo parameter
are parts known only once deployed, and a name built of the imports and text
(`` `arn:aws:sqs:${this.region}:${this.account}:${prefix}-${stage}-audit` ``)
is written by the linker where every part is joined. In Terraform, an
interpolation is read the same way over `data "aws_ssm_parameter"` values and
outputs of another configuration's state
(`data.terraform_remote_state.<name>.outputs.<output>`), which are values
another deployment publishes under `state:<backend identity>#<output>`; a
root module whose backend is written publishes each of its outputs under that
key - a point of an API as before, anything else as what it names or its text
- so a state output a deployment reads is joined to the configuration that
writes it.

**A failure destination of an import, under a mapping read as alternatives.**
Where a mapping reads an import (a stream or a table's changes) and hands what
it gives up on to an import too (a queue or a topic), the destination is drawn
once per kind under each of the mapping's readings, its own import listing
them: the linker keeps the destination of the kind its publisher says, of the
reading the mapping's publisher says, and renames it back through both choices
to the address it is written at. No row.

**sceptre: inheritance, Jinja, stack outputs.** A stack inherits the
`parameters` and `sceptre_user_data` of every group `config.yaml` above it,
merged key by key, the nearer winning. Every configuration file is rendered
first: `{{ var.x }}` with what the commands that launch the stack give it -
`sceptre --var x=y --var-file f.yaml launch <path>` written in a
`package.json` script, a Makefile recipe, a shell script, a GitHub Actions
step or a GitLab CI job, where the path is the stack, its group or a group
above it - and the var files `services[].infra.vars` names; `{{
environment_variable.X }}` and `!environment_variable X` with the environment
those commands run in (an `export`, an assignment before the command, a
pipeline's `env:` or `variables:`); `| default(<literal>)` where nothing gives
the value. Any other Jinja - a filter, a call, a statement, a value nothing
gives - stays a value not known. `!stack_output <stack>.yaml::<Output>` is the
output of that stack of the project, by the name it is launched under, and
`!stack_output_external <stack name>::<Output>` of a stack by its name: each
is joined to the deployment that publishes `stack:<name>#<Output>`, in this
repository or another. A template ending in `.j2` under a project's
`templates/` is rendered with the stack's `sceptre_user_data` where every
expression in it is `{{ sceptre_user_data.x }}` of a plain value; otherwise
none of it is read, and an `infra-file-unparsed` row says which expression is
not rendered. Several commands launching one stack with values of their own
are a `parameter-file-ambiguous` row, and naming one's var file under
`services[].infra.vars` chooses it.

**rain: every option, every place a command is written.** `rain deploy` is
read in the same places as sceptre's commands - a shell script's `cd` and a
pipeline's `working-directory` followed, a line ending in `\` joined to the
next - with every option of `rain deploy`: `--params` written more than once,
the switches (`-y`, `--keep`, `--detach`, ...), and the options with a value
(`--node-style`, `--role-arn`, `--s3-bucket`, ...) whose value is not taken
for the stack. An option this does not know written before a word leaves the
stack's name unread rather than taking the word for it. A pipeline expression
(`${{ inputs.stage }}`) is a value not known, as a shell variable is. The same
command in a pipeline and a script is one deployment
(`fixtures/multi-repo-deploy-values`).

#### Failure destinations of every mapping, Jinja statements, sceptre's resolvers and Terraform directives

**A mapping's failure destination, wherever it is written (P264).** A
CloudFormation or SAM `AWS::Lambda::EventSourceMapping`'s
`DestinationConfig.OnFailure.Destination`, a SAM stream event's
`DestinationConfig.OnFailure` (of the kind its `Type: SQS | SNS | S3` says), a
Serverless stream event's `destinations.onFailure` (an ARN, or `{ arn, type }`)
and the CDK's `onFailure` of a stream event source or an `EventSourceMapping`
(`new SqsDlq(queue)`, `new SnsDlq(topic)`, `new S3OnFailureDestination(bucket)`,
whose class says the kind) hand what the mapping gives up on to the
destination, as Terraform's `destination_config` does. Where the mapping reads
a value another deployment publishes and the destination is one too, the
destination is read once per kind under each of the mapping's readings, and
the linker keeps the one under the reading kept, as it does for Terraform
(P261). A bucket is a destination nothing is delivered to, and is said at
`info`.

**Jinja statements and filters in sceptre's files.** Every configuration file
and `.j2` template is rendered with `{% if %}` / `{% elif %}` / `{% else %}`,
`{% for %}` over a list or a mapping's `items()` (with `loop`), `{% set %}`,
`~`, `+`, comparisons, `and` / `or` / `not`, `in`, `is defined`, `a if c else b`,
and the filters `default` (`d`), `lower`, `upper`, `trim`, `replace`, `join`,
`int`, `string`, `title`, `capitalize`, `length` and `tojson`; `-` trims the
space beside a tag. A condition on a value the files do not give is rendered
both ways, up to 16 ways in all, and only what every way writes alike is read:
a parameter the ways write differently is a value not known, naming the
condition. A loop over a value not given, a filter, a test or a statement not
listed here leave the file read as before - a configuration file with a
statement is passed over, a template not read. `{{ stack_group_config.x }}` is
the configuration of the groups above the file, merged down, as sceptre
renders it; `sceptre --merge-vars` merges its var files key by key at every
depth rather than replacing their top-level keys.

**sceptre's other resolvers.** `!file <path>` is the contents of a file of
the project (a `.yaml` or `.json` one read as YAML), `!stack_attr <field>`
another field of the stack's merged configuration (`parameters.Prefix`,
`sceptre_user_data.stage`), `!join [sep, [...]]`, `!split [sep, value]`,
`!select [index, list]` and `!sub [format, { name: value }]` the join, split,
pick and format of what they are handed - a stack output among the parts kept
in place, so a name built of it and text is written by the linker once the
output is joined - and `!no_value` leaves the parameter to the template's
`Default`. `!rcmd` and `!cmd` run a command when the stack is launched, and
are said as a value not known.

**Terraform template directives around an import.** `%{ if }` / `%{ else }` and
`%{ for }` in a string template, or in a file `templatefile` renders, are read
part by part as an interpolation is: a condition the files decide renders its
branch, a loop over a list they settle each item, with every value another
deployment publishes inside kept in place. A condition they do not decide is
read both ways: a name every way writes alike is read (a region chosen by
`var.secondary` beside the name), and one the ways write differently is not -
the value says which condition decides it (`fixtures/multi-repo-failure-values`).

### Procedures

A tRPC server's ways in are not routes: each procedure is a key in a tree of
object literals, and its address is every key from the root down to it —
`orders.list`, the same string its callers write. Each is an entry of kind `rpc`,
with its body, its guards and the mount file that serves the tree
(`fixtures/trpc-router`). A tree that is the value a call produced, a member
under a computed key, and a branch imported from a package this repository does
not have are each a row rather than an invented way in.

A guard written in place — `authedProcedure.use(async ({ ctx, next }) => …)` —
is a node named for where it is (`bookingsProcedure.use@20`), and the queries,
requests and settings in its body hang off that node, so a walk from the way in
reaches what its guard reads. What every handler and guard is handed as `ctx` is
read from the one place the source writes it, the type argument of
`initTRPC.context<…>()` — through the function it names, where that is how the
context is built — so `ctx.prisma.booking.findFirst(…)` and
`const { prisma } = ctx` are read with nothing installed. A client handed to a
transaction's callback, `prisma.$transaction(async (tx) => …)`, is read as the
client it was handed by (`fixtures/trpc-inferred-context`).

A caller writes the same path as property accesses on a client proxy —
`trpc.orders.list.useQuery(input)`, `client.orders.create.mutate(order)` — and
each call is a request of kind `rpc` carrying the path and what it does on the
server's side, `query` or `mutation`. The linker joins it by the path in exactly
two places: the caller's own service, then the services its `apiTarget` names.
It never joins on the string alone, because a procedure path is short and common,
and an edge made on a coincidence would be two services that never speak. A call
made as a mutation to a procedure declared a query joins and says so in a
`procedure-call-mismatch` row (`fixtures/trpc-join`). `adapters.entry.procedures`
exposes the description the shipped reader is written as, for another framework
of the same family.

**oRPC** is the second row of the same description, read by the same walk
(`fixtures/orpc-next`, `fixtures/orpc-contract`). What differs:

- **A procedure** ends in `.handler(fn)`, so every one is `rpc` and every
  client call asks for `handler`. Its `.input(…)` and `.output(…)` give the
  signature (zod, valibot or any schema whose type says what it checks), and
  `.errors({ NOT_FOUND: {…}, RATE_LIMITED: { status: 429 } })` declares the
  failures it answers with, recorded with their statuses under `meta.errors`
  (the library's table where the declaration writes none).
- **A router** is any object whose values are procedures. `os.router({…})` is
  read too, and what its chain installs - `os.use(audit).prefix('/v1')` - is in
  front of every procedure under it, before the procedure's own guards; the
  prefix applies to the REST route of each one that writes a path.
  `lazy(() => import('./reports'))` is followed into that module's default
  export - by the checker, through `compilerOptions.paths` and the aliases a
  Vite configuration or Nuxt declares (P256: the procedure adapters state Vite's
  `resolve.alias` as the browser adapters do, so a server Vite builds resolves
  `import('@lib/reports')` too), or, where it cannot resolve the `import()` (an
  alias declared nowhere, P252), by the one file of the service its path names
  (relative to the importing file, or what follows `@/`, `~/`, `~~/` or `#`,
  with the endings a bundler tries and `index`). A lazy branch neither finds
  is `procedure-branch-unread`, saying it is a lazy branch, and a module whose
  path ends as the `import()` writes it is not read as a root of its own (the
  row names it). A computed key is `procedure-key-dynamic`.
- **Contract-first.** `implement(contract)` hands back a builder whose property
  accesses name the contract's members: `os.orders.list.handler(fn)` reads its
  input, output, errors and route off `contract.orders.list`, through
  `oc.prefix(…).router({…})`. An implementation of a member the contract does
  not have, or a contract that cannot be followed, is
  `procedure-contract-unread`, and the procedure keeps what it writes itself.
- **Mounts** are handler objects, `new RPCHandler(router)` and `new
  OpenAPIHandler(router)` from any adapter, and the prefix each answers under is
  the `prefix` option of its `handle(…)` calls in the same file. Every
  procedure records where it is mounted (`meta.mounted`: protocol, prefix,
  file). Under an `OpenAPIHandler`, each procedure is also an HTTP route at the
  prefix plus its `.route({ method, path })`, or `POST` plus its keys where it
  writes none, with the same handler and guards and `meta.procedure` naming it;
  a REST caller joins it as it joins any route. A prefix that is not text, or a
  mount nothing in its file hands a request, is `procedure-prefix-unread`.
- **Callers.** `client.orders.list(input)` on a client from `createORPCClient`,
  and the query utilities' `queryOptions({ input })`, `mutationOptions()`,
  `infiniteOptions`, `call`, are requests; `key()` is not. The URL of the link
  the client was made with - `new RPCLink({ url })`, `new OpenAPILink(contract,
  { url })` - is read through the browser reader's address reading into
  `meta.link`, and its settings key decides the service: the one the caller's
  `apiTarget` names for it, or the one service that claims it (`via:
  link-url`). A URL worked out per request is `procedure-link-dynamic`, and the
  join falls back to the caller's own service and `apiTarget`. A link sent to a
  path where no mount of its protocol serves the tree joins and writes
  `procedure-link-unserved`.
- **In process.** `createRouterClient(router)` and `call(procedure, input)`
  are requests that never leave the service (`meta.inProcess`), joined by the
  procedure's declaration (`meta.procedureAt`), exact even where the path is
  relative to a branch.
- **Failures.** `throw new ORPCError('NOT_FOUND')` and `throw errors.NOT_FOUND()`
  are read into `meta.fails` at the code's status (`errors.X` at the status the
  procedure declares), what a function guard throws is read from its body, and
  a procedure with an input can fail with the 400 its schema refuses with.
  The same reader reads `new TRPCError({ code })`.
- `dead` and the route survey count a procedure's REST route as called when the
  procedure is, and the catch-all route of the file that mounts the tree when a
  request crosses it.

`contracts` compares a caller of a procedure with it in both directions (P247,
`fixtures/rpc-contracts`): the input the call hands against the procedure's
`.input(…)`, and, where the call returns the answer - `client.orders.get(input)`,
`.query(input)`, `.mutate(input)`, `call(procedure, input)` - what it reads back
against the procedure's `.output(…)` or its resolver's return. A worker whose
hand-copied type of the tree says `qty` where the procedure takes `quantity` is
a `missing_required` error and an `extra_field` note, as a request body would
be. An answer handed to a hook or a query's options is typed where it is read,
so nothing at the call states it (`procedure-output-inferred`).

**A plain request to a procedure's REST route** is compared both ways too
(P256, `fixtures/rpc-shared-types`). The OpenAPI handler hands the procedure
one input assembled from the request, so the caller's half is assembled the
same way from what it writes:

- by default (`compact`), the route's path parameters (`{id}` in its route)
  merged with the query for a `GET`, or with the body for any other verb;
- for a route written `.route({ inputStructure: 'detailed' })`, `{ params,
  query, headers, body }`, each part the call writes under its own key, the
  headers by the names it writes in place (`meta.headerKeys`, lower-cased:
  `headers: { 'X-Tenant': t }`, `new Headers(...)`, Angular's `HttpHeaders`,
  P258). A twin route records `meta.inputStructure` /
  `meta.outputStructure` where they are `detailed`.

A `detailed` input's headers are compared from the procedure's end too
(P262). Only the names the procedure declares are sent to the comparison - a
request carries headers its middleware, proxy and platform read and no input
names - each lower-cased, as a server hands every header on; a name the
procedure's schema spells with a capital (`'X-Region'`) is never handed to it
as spelled, and the finding says so. A request's headers include those its
client instance is made with (`axios.create({ headers })`, `ky.create`,
`extend`, `ofetch.create`) and those an Angular interceptor sets with
`req.clone({ setHeaders: { ... } })`. Where they are written and cannot be
read (a name, a spread, a field), or where something the reader cannot see
may add to them - a hook or an interceptor of the instance, the call's own
hook, a default assigned to the client's `defaults.headers`, an Angular
interceptor that sets its headers another way - the request records
`meta.headersUnread`, and the headers are not compared (`any-unknown-skip:
headers` in the edge's `rulesApplied`) rather than called missing. A call that
writes none and runs through nothing that adds any sends none: what the
procedure requires there is missing.

A path parameter and a query key are compared by name alone: the address
carries text, and whether the schema coerces it is the schema's to say. The
query is read from the address (`?category=tea&sort=price`) and from the
client's query option written in place - axios's `params`, ky's and got's
`searchParams`, ofetch's `query` or `params`, Angular `HttpClient`'s `params`
- which a request records as `meta.queryKeys` and `meta.queryType` (and
`meta.queryUnread` where its options are handed by a name). A query built in
code is read the same way (P258): `new URLSearchParams({ ... })`, `('a=1')`
or `([['a', '1']])`, and each `append` / `set` on the name holding it in the
scope it is declared in; Angular's `new HttpParams().set('a', x)` chains,
`params = params.set(...)` and `new HttpParams({ fromObject })`; one built
into the address (`` `/products?${params}` ``), whose keys are recorded
beside the `${…}` the address shows (`meta.queryInAddress`); and on a server,
the `query` / `params` / `searchParams` a wrapper writes itself, beside what
its caller hands it (`{ ...params, limit }` is the caller's keys and
`limit`). A key written as code leaves the query `queryUnread`; one held in
a name whose type is one string - `const PAGE = 'page'`, a member of an `as
const` object or of an enum, `{ [PAGE]: 1 }` - is that key (P262). An address
built with `+` after its `?` (`'/products?' + params.toString()`, `` `${base}/search?`
+ params ``) is the address before the `?`, with the query `${…}` and its keys
recorded where the query is built, in the browser, Angular and the server
readers alike (P262). The body is
compared field by field. A `GET` that writes no query and no path parameter
sends an empty input, and what the procedure requires is missing. What the
call reads back (`axios.get<Product>`, `fetch<Order>`) is compared with the
procedure's output, or the output's `body` for `outputStructure: 'detailed'`;
a call that types no answer is `no-type-on-receiver`. A query written in a
way nothing reads (a query string built elsewhere, options handed by a name)
is `procedure-input-by-name` with detail `query`; a body with no type is
`no-type-on-sender`. A procedure's own client that reaches the route keeps
its rows.

**Where a tRPC tree is served** (P247) is read from its mount, so a tRPC link's
path is checked against it as an oRPC one is (`procedure-link-unserved`):
`app.use('/trpc', createExpressMiddleware({ router }))` (the path of the `use`
call it is handed to, in place or by its name), `fetchRequestHandler({ endpoint
})`, `createHTTPServer({ router, basePath })` and `createHTTPHandler` (`/`
without one), and a Next.js handler by the file it is in, its last parameter
taken off (`pages/api/trpc/[trpc].ts` and `app/api/trpc/[trpc]/route.ts` are
`/api/trpc`), Fastify's plugin by the `register` call it is handed to,
`server.register(fastifyTRPCPlugin, { prefix, trpcOptions: { router } })` (`/`
without a prefix), and Hono's middleware `trpcServer({ router, endpoint })`
(`/trpc` without one; P256). Every tRPC procedure records it in
`meta.mounted` with protocol `trpc`; an address that cannot be read is
`procedure-prefix-unread` (info). A description's mount may say the same of
any framework: `plugin: { method, at }` for a plugin handed to a call rather
than called, and a dotted `treeKey`.

**A tree a workspace package holds** (P256) is read as the ways in of the
service that mounts it, and of no service that only imports it for its type:
a browser application whose client is `createTRPCClient<AppRouter>`, with
`AppRouter` exported by the package the server mounts, holds the package in
its extent and reads no procedures from it. Its calls join the server's
procedures by their links, and are compared through the shared type.

**A server's client** of another service's tree is read the same way, by the
same reader (`fixtures/rpc-server-to-server`). A NestJS, Express, Hono or plain
Node service, or a worker, that builds an oRPC client
(`createORPCClient(new RPCLink({ url }))`, `OpenAPILink`, a client typed by a
contract) or a tRPC client (`createTRPCClient`, `createTRPCProxyClient`,
`createTRPCUntypedClient`) and calls a procedure through it -
`orders.orders.place(input)`, `billing.invoices.create.mutate(input)`,
`untyped.mutation('invoices.refund', input)` - gets an `http_out` of kind `rpc`
carrying the path, joined to the `entry:<service>:rpc:<path>` of the service the
link's address names:

- **Where the client is.** A module-level name, a hook's result, or the class
  member a provider keeps it in, set where the member is declared or in the
  constructor (`this.orders.orders.place(…)`). A member injected by a token -
  `@Inject(BILLING) private readonly billing`, or Angular's `inject(BILLING)` -
  holds what the repository provides for the token, `{ provide: BILLING,
  useFactory }` (the client the factory returns, written in place, named, or one
  call of the repository's own away) or `{ provide: BILLING, useValue }` (P247).
  One provider of the token is followed; none or several is nothing, and the
  injection reader's rows say why. The `call-through-token` row at a call read
  this way goes.
- **A configured module** (P256). A provider a module's own method builds -
  `OrdersClientModule.forRoot({ url })`, `forRootAsync({ useFactory, inject })`,
  written in this service or in a workspace package it declares - counts where
  the method is called; the one beside it nothing calls provides nothing. Its
  link's options and URL are followed through a parameter one call away: a
  parameter of a method or function is the argument of the repository's one
  call of it (`options.url`, or `{ url }` destructured), and a parameter of a
  provider's factory is what is provided for the token in its place of
  `inject`, a factory handed in (`useFactory: options.useFactory`) being the
  one written at the call. Two calls, or two providers, are nothing followed.
  The NestJS injection reader finds such a token by the same index (P259); an
  alias it finds (`{ provide: LEDGER_CLIENT, useExisting: LEDGER }`) is
  followed to the class or the provider the aliased token is, and an alias of
  a token nothing provides is `di-token-unknown` naming both (P261).
- **A settings object's token** (P261). `@Inject(appConfig.KEY)`, `appConfig`
  a `registerAs('app', ...)` of `@nestjs/config`, and
  `@Inject(getConfigToken('app'))` are provided by a provider where the
  `registerAs` is written, where the application loads it
  (`ConfigModule.forRoot({ load: [appConfig] })`, `ConfigModule.forFeature(appConfig)`);
  one nothing loads is `di-token-unknown`. Read from the import's package name,
  so a repository whose packages are not installed reads the same.
- **A module import chosen in the repository** (P261). An entry of `imports:`
  chosen by a condition literals decide (`IN_MEMORY ? MemoryModule : database()`
  with `const IN_MEMORY = false`), a `const` holding one, the answer of a
  function of the repository (`database()` returning `DatabaseModule.forRoot(...)`),
  and the modules spread in from such a list (`...(STAGE === 'prod' ? [MetricsModule] : [])`)
  are followed to the module each is; a condition read when the application
  runs (`process.env.MAIL`) stays `module-import-dynamic`
  (`fixtures/nest-followed-tokens`).
- **A module of a package that is not installed** (P264). An `imports:` entry
  whose class is imported from a package the repository has not installed
  (`import { BullModule } from '@nestjs/bullmq'`) is no computed import: it is
  read as the module its import names, of the package its specifier names,
  as an installed package's module is - so the tokens a known module provides
  (`ClientsModule.register([{ name: 'EVENTS' }])`) are provided - and said by a
  `module-import-not-installed` row naming the package, since its class is not
  there to read. `module-import-dynamic` is kept for an import computed when
  the application runs.
- **The address.** Read by the server's own address reading, the one every
  request between services gets: `process.env.ORDERS_URL`, a configuration
  service's `get('ORDERS_URL')`, a constant. A setting goes to the service that
  claims it under `services[].baseUrlEnv`, or to the one its values name (P77);
  a host written in the URL goes to the service `services[].hosts` says is
  reached there, and another host is a third party. A join through a value the
  deployment does not give is `heuristic` and says so in a
  `base-url-from-files` row; a setting nothing places is `unknown-base-url-env`,
  as for any request. Only the service the link names is asked; a path it does
  not declare is `procedure-not-found`, naming both services asked.
- **tRPC's links**, in the browser as in a server: the last link of
  `links: [...]` sends (`httpBatchLink`, `httpLink`, `httpBatchStreamLink`,
  `httpSubscriptionLink`), the links in front of it are stepped over, and
  `splitLink({ true, false })` sends where its branches agree. A proxy whose
  factory is handed no link - `createTRPCReact()`, `useTRPC()`, a client handed
  to a provider - sends where the repository's own chains of links send, when
  they all send to one address (`meta.link.from: repository`). Branches or
  chains that send to different addresses, or a last link this does not read,
  are `procedure-link-dynamic`.
- **A WebSocket link** (`wsLink`) opens a socket whose address is the WebSocket
  client's, which is not read: a subscription sent through one, or any request
  through a client whose only link is one, is `procedure-link-socket` and is
  joined as a request with no link is.
- **Both halves at once.** A repository the browser half reads as well has its
  calls read there first; the server's pass leaves those sites alone, so no
  call is two requests. A receiver the calls reader could not type because the
  client is `any` is no longer a `call-dynamic-receiver` row once the call is
  read as a request.
- **A setting nothing places** is evidence of a repository that is not here,
  as for any request rooted at it: `doctor`'s *Probably missing* counts the
  link's setting and the hosts its values name (P247).

**An Angular application's client** is read by the same reader too (P247): a
tRPC or oRPC client made at the top of a module, or provided for a token and
injected, called from a component's or a service's method, is a `ui_api_call`
of kind `rpc`, its link read by the Angular reader's address reading.

### Workflows written as state machines

A state machine written in the Amazon States Language is the order a project's
steps happen in, written down. Every repository a server reader reads is also
searched for definitions kept as files of their own - `*.asl.json`,
`*.asl.yaml`, `*.asl.yml`, the convention the public samples and editors use -
and each is drawn as a way in of kind `workflow`. Nothing to configure.

- **The machine** is an entry, `entry:<service>:workflow:<name>`, that `handles`
  its `StartAt` state. `flow workflow:<name>` names it.
- **Each state** is a `function` node of kind `state`, with the state's type in
  `meta.stateType` and its id `<service>#<file>:<workflow>/<state>`. A state
  nested in a `Parallel` branch or a `Map` processor is a node like any other,
  with `meta.scope` saying where it sits. What a state is given and passes on -
  `Parameters`/`Arguments`, `ResultSelector`, `ResultPath`, `InputPath`,
  `OutputPath`, `Output`, `Assign` - and its `Retry` are kept on the node as
  written, so `--detail 2` shows them. Nothing is evaluated.
- **Every transition** is a `calls` edge from one state to the next, and
  `meta.transitions` on it says which way it is: `next`, `choice` (with the rule
  as written), `default`, `catch` (with the errors), `branch` (with its index)
  or `item-processor`. Two ways between the same pair of states - a rule and the
  default both going to one state - are one edge listing both. Every branch is
  drawn and none is preferred.
- **A task that starts another workflow** (`states:startExecution`, with
  `.sync`, `.sync:2` and `.waitForTaskToken`, and the SDK's `sfn` spelling) is
  joined to that workflow's entry by the name in its `StateMachineArn`, in
  whichever service declares it, the way a publisher and a consumer meet on a
  channel's name.
- **A task that invokes a function** (`lambda:invoke` with `FunctionName` as a
  name, a partial ARN or a full one, or the function's ARN as the `Resource`)
  carries a reference to the function by its deployed name, `invoke:<name>`, and
  the linker joins it to the `invoke` entry of that name in whichever service
  deploys it (see [Functions and routes declared in
  Terraform](#functions-and-routes-declared-in-terraform)). A name no configured
  service deploys is a `reference-not-found` row.
- **A task that reads or writes a table** (`dynamodb:getItem`, `putItem`,
  `updateItem`, `deleteItem`, and through the SDK `query`, `scan` and the batch
  and transaction calls) is a `db_query` on that table. A write - `putItem`,
  `updateItem`, `deleteItem`, `batchWriteItem`, `transactWriteItems`, optimised
  or `aws-sdk:` - is also a producer at the step onto `dynamodb/<table>`, kept
  only where some service declares the table's stream, exactly as a function's
  write is ("A write to a table is a publish only where its stream is"): so a workflow's write reaches the function the
  stream runs. A transaction's `ConditionCheck` writes nothing and names no
  table (P55). A batch or a transaction whose whole list is chosen at run
  time - `RequestItems.$`, `TransactItems.$`, or the list as a JSONata
  expression - names no table, and is one `workflow-target-dynamic` row for
  the state, naming that field (P62).
- **A task that puts a record on a stream** (`aws-sdk:kinesis:putRecord`,
  `putRecords`, by `StreamName` or `StreamARN`) is a producer onto
  `kinesis/<stream>`, joined to a mapping from that stream by name (P55).
- **A task that sends a message** (`sqs:sendMessage`, `sns:publish`,
  `events:putEvents`, their batch forms, and the `aws-sdk:` spellings) is a
  producer at the step, the way a call that sends is one in code, `static`,
  with an `emits` edge onto each channel it names: `sqs/<queue>`,
  `sns/<topic>`, `eventbridge/<bus>/<source>/<detail type>`, the bus an entry
  leaves out written `default`. The message it is given is kept as written on
  that edge, `meta.payload` (`{ "MessageBody.$": "$.notice" }`). The channel is
  spelled the way the subscriber a deployment declares spells it (see
  [Subscribers declared in Terraform](#subscribers-declared-in-terraform)), so a
  mapping from the queue, a subscription to the topic or a rule on the bus, in
  any repository, is joined to the step by name. An event whose source or
  detail type is chosen at run time names no channel and is a row, like any
  other name that is not written.
- **Any other integration** - `aws-sdk:s3:putObject`, `glue:startJobRun.sync` -
  is a step whose `meta.task` says the service, the action and how the state
  waits for it. It joins nothing, and is still in every walk.

**What is never guessed.** A name the definition does not state is a row, and no
edge: `workflow-target-dynamic` where the state chooses it at run time (a
`.$` path, a `States.` intrinsic, a JSONata `{% %}` expression), which is
nothing to fix; `workflow-template-unbound` where it is a `${...}` placeholder
that whatever deploys the definition fills in first; and
`workflow-target-unreadable` where the field is missing or names nothing. A
placeholder standing only for the region or the account in front of a written
name - `arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:notify-borrower`
- still names the function.

**What a definition on its own cannot say** is the name it is deployed under. So
a workflow read from a file is named after the file - `loan-approval.asl.json`
is `loan-approval` - its entry says `meta.nameFrom: "file-name"`, a
`workflow-named-by-file` row says so, and every join made to it by that name is
`heuristic` rather than `static`. Two definitions in one service with one file
name are a `workflow-name-duplicate` row, and only the first is drawn. A file
that does not parse, or parses into something with no `StartAt` and `States`,
is one `workflow-definition-unreadable` row and nothing else; a definition that
names a state that is not there is drawn as written beside a
`workflow-definition-invalid` row (`fixtures/stepfunctions-asl-files`).

A definition file is stamped with the sources, so changing one rebuilds its
service.

#### A state machine declared in Terraform

Where the repository's Terraform declares the machine -
`aws_sfn_state_machine`, directly, through a local module, or through
`terraform-aws-modules/step-functions/aws`, which ships described - the
workflow is read from there, under the `name` the machine is deployed with,
evaluated: `name = "${var.prefix}-loan-approval"` is `lending-loan-approval`,
whatever the definition's file is called. Its entry says
`meta.nameFrom: "deployment"`, `meta.declaredAs` and `meta.declaredIn` say
where, and every join made to it by name is `static`. The definition is read
however it is written, followed back through any variable or local that only
hands it on:

| Written as | Read as | Placed on the lines of |
|---|---|---|
| `file("${path.module}/loan-approval.asl.json")` | the file | the file |
| `templatefile("loan-renewal.asl.json", { ... })` | the template, rendered with the variables it is handed, directives included | the template |
| `jsonencode({ ... })` | the value | the `.tf` file, each state where its key is written |
| a heredoc, or a quoted string | the text, rendered | the `.tf` file |
| `jsonencode(yamldecode(file(...)))`, `jsondecode` likewise | the file, in the format the decoder names | the file |

A value that is not text yet - a template variable holding
`aws_lambda_function.x.arn`, `module.f.lambda_function_arn` or
`aws_sfn_state_machine.y.arn`, a `Resource = aws_lambda_function.x.arn` inside
`jsonencode`, an interpolation in a heredoc - is left in the definition as a
placeholder, and the deployment fills it with what it addresses: the deployed
name of the function, the workflow, the table, the queue, the topic or the bus
it refers to, created or looked up by a `data` block. So a task names its
function through Terraform as plainly as by a literal, and its edge is `static`
where every name resolved. A placeholder the files do not settle - a variable
with no default and no variable file - stays unfilled, and the step that uses
it is one `workflow-template-unbound` row and no edge; the rest of the workflow
is drawn.

A definition that is also named `*.asl.json` is read once, by the deployment
that loads it, and not a second time under its file's name. A machine whose
name is not read is drawn keyed by its declaration, which nothing can join to,
beside a `workflow-name-unread` row saying what to set; a definition that
cannot be read at all - a path or a directive the files do not settle - is one
`workflow-definition-not-loaded` row and nothing else. Every file `file()`,
`templatefile()` or `fileexists()` opened while the configuration was read is
stamped with the sources, by the path the evaluator was handed - built through a
local or a variable as readily as written out - so changing it rebuilds the
service (`fixtures/stepfunctions-terraform`,
`fixtures/multi-repo-stepfunctions`).

What starts a machine - a schedule, an event rule, another service's code - is
joined to the same entry, `workflow:<deployed name>`, as those are read.

#### Walking a workflow

`flow workflow:<name>` takes, at each step, what the step does first - the
function it invokes, the table it writes - and then where control goes next in
the order it goes there: a `Parallel`'s branches, a `Map`'s processor, each
`Choice` rule and its `Default`, `Next`, and each `Catch` last, wherever each is
written in the file. Without `--depth`, a walk from a workflow goes one hop per
step the workflow has, which is enough to reach its last step along the
longest way through it, and the usual eight beyond that, into whatever the
deepest step reaches; `--max-nodes` still bounds what is printed. `impact`
without `--depth` is lengthened the same way, read backwards: a walk up from a
handler climbs a workflow one step at a time from whichever step reaches it, so
it goes the usual eight hops and one more for every step it climbs, and reaches
whatever starts the workflow - a route in another repository, a rule, another
workflow - without being told how far (`fixtures/multi-repo-stepfunctions`).
The `impact` tool of the graph server does the same from its own twelve.

### Code that starts a workflow or a function

A handler that starts a state machine or invokes another function names it by
the name it is deployed under, and the call is joined to the `workflow` or
`invoke` entry of that name, in whichever service deploys it, the way a step of
a workflow is. So `flow 'POST /loans'` goes on from the handler into the
workflow it starts and every function that workflow invokes. The call is drawn
as a producer labelled with what it does and the name - `start
lending-loan-approval`, `invoke lending-hold-copies` - that carries a reference
(`meta.reaches`) the linker joins, and never as a channel: a workflow or a
function has exactly one receiver, which the deployment names.

**Through the SDK** (see [The AWS SDK](#the-aws-sdk)):

| Operation | Starts | Name from | Recorded as |
|---|---|---|---|
| Step Functions `StartExecution` | the workflow | `stateMachineArn`, its version or alias dropped | `start` |
| Step Functions `StartSyncExecution` | the workflow, and waits for it | `stateMachineArn` | `start-sync` |
| Lambda `Invoke` | the function | `FunctionName`: a name, a partial or a full ARN, a `name:alias` | `invoke`, or `invoke-async` where `InvocationType` is `Event` (`invoke-dry-run` for `DryRun`) |
| Step Functions `SendTaskSuccess`, `SendTaskFailure` | nothing: it answers a run waiting on a `.waitForTaskToken` step | - | `task-success`, `task-failure`, a leaf on the handler that joins nothing, because a token names a run and no workflow |

A name read from `process.env` is completed from the deployment exactly as a
queue's is: the call waits on the variable (`meta.awaiting`, and a
`start-from-environment` row), and where a function whose Terraform sets it -
`LOAN_APPROVAL_ARN = aws_sfn_state_machine.loan_approval.arn` - runs the call,
the name is that workflow's and the row goes (`fixtures/start-workflow-sdk`).

**Through a helper whose source is read.** Where the call is inside a method or
a function of the project's own - in a workspace package, one installed, or the
service itself - and the name it starts is that helper's parameter, the start is
the caller's: each call of the helper is followed out, the argument passed there
is read as the name would have been, and the start is drawn at that call, in the
caller. A caller that is itself handing the name on is followed further. Nothing
is drawn inside the helper unless nothing calls it, a call may land in another
implementation, or a caller's argument reads less than the helper's own: a
caller is drawn on only where it says as much as the helper does, so following
a value out is never worse than leaving it where it is written. This is the forwarding every reader shares - a shared
HTTP client's requests get it too - and it follows a method through its
receiver, and a function written `function start(arn)` or `const start = (arn)
=> …` called by its name, by a name it was imported as, or through its module's
namespace (`fixtures/start-workflow-function-helper`). A request followed out to
a caller whose value is not read keeps the address it states: a hole that fills
one segment stays a route parameter, and one that fills part of a segment -
`bot${token}` - leaves the request in the helper, `static`, with the caller's
call into it (`fixtures/nest-helper-keeps-request`).

**Through a helper whose source is not here, described.** A package shared by
a project's services is often not installed where someone first reads one: a
private registry, a repository nobody here has cloned. `adapters.starters`
describes its call:

```jsonc
"starters": [{
  "module": "@library/orchestration",   // the package the helper is imported from
  "function": "run",                    // or "receiverType" and "method"
  "target": "workflow",                 // or "invoke"
  "name": [{ "kind": "argument", "index": 0 }],
  "names": { "Process.LoanApproval": "lending-loan-approval" }
}]
```

| Key | Means |
|---|---|
| `module` | the package. With `function`, the call is `run(...)` imported under that name or `orchestrator.run(...)` on anything imported from the package, matched on the import, so an absent package is matched as readily as an installed one. With `receiverType` and `method`, it is the package the receiver's class comes from |
| `function`, or `receiverType` and `method` | which call it is, as for a [`broker.custom`](#adapters) producer |
| `target` | `workflow` or `invoke`: what the name is the deployed name of |
| `name` | where the name is written, in any [locator](#where-the-channel-name-is-written), tried in order |
| `names` | optional: what the code says, to the deployed name, where the two differ. A key is what the name reads as, or the expression as written where that cannot be read - an enum member of a package that is not here is `Process.LoanApproval` |
| `kind` | optional: what the call is recorded as; `start` or `invoke` by default |

**A start addressed by a record made one call earlier.** Some helpers record
what to start in one call and start it in the next, by the record's id:

```ts
const run = await orchestrator.create({ process: Process.LoanApproval, loanId });
await orchestrator.start({ runId: run.id });
```

The second call is the start, and its arguments do not hold the name. The
`origin-call-argument` locator reads it from the first:

```jsonc
"starters": [{
  "module": "@library/orchestration",
  "function": "start",
  "target": "workflow",
  "name": [{ "kind": "origin-call-argument", "call": "create", "path": ["process"] }],
  "names": { "Process.LoanApproval": "lending-loan-approval" }
}]
```

| Key | Means |
|---|---|
| `call` | the call that made the record: a method on the same receiver as the start, or a function imported from the same module |
| `path` | properties inside that call's argument, as for `argument-path`; empty is the argument itself |
| `index` | optional: which argument of that call the path starts in, the first by default |

A value the start is handed - `run.id`, `id` from `const { id } = await
create(...)`, a `const` holding either - is followed back to the call that made
it. Only within the body the start is written in, only through `const`
bindings, and only to exactly one call of that name. Anything else - an id from
the request, a `let`, a record made in another function, two records either of
which could be the one, a path that ends at a parameter - reads as
`start-name-unread`, and nothing is guessed (`fixtures/start-workflow-by-record`).

**How far each join is trusted.** A name the code states and the deployment
confirms is `static`, whether the SDK, a read helper or a described one states
it. A name taken from a `names` table is `declared`: somebody wrote the mapping,
nothing here can check it, and a stale table must not read as proof - the same
level a service read from its OpenAPI document has. A deployed name is never
guessed from an enum member's spelling; a convention can be written in `names`,
and is never inferred.

It is a description of its own rather than a `broker.custom` producer because
what it describes is not a message. Described as a publish, every state machine
would be a channel and every function a consumer of one, and `dead` and the
reverse walk would answer about them in channel terms.

**`doctor` says which helper to describe.** A call from the handler of a
deployed function into a package whose source is not read has the shape of a
start nobody has described when one of these holds, tried in order:

| The package | The call |
|---|---|
| is not installed | is handed an id - `id`, `runId`, `executionArn` - read off what a call into the same package returned earlier in the same body |
| is installed with its declared types only | is declared in types that import a client that starts something: Step Functions or Lambda, version 3 or 2 |

A call handed a string or a member of an enum and nothing else is not enough:
error builders, response mappers and code converters are handed exactly that,
and start nothing. Each shape is one `starter-undescribed` row per package and
function, at the first call, with the description to write in the hint and in
`meta.description`: an `origin-call-argument` locator pointing at the call that
made the id, where there is one, and the `target` the client's types say where
they say one. Filling in the deployed name is left to you. A call another
reader already drew - a request, a query - is not reported. Making the
package's source readable here answers the row as well
(`fixtures/start-workflow-by-record`).

A described call is read, so it leaves no `call-dynamic-receiver` row: the call
graph writes one for a receiver it cannot type, as every call into a package
that is not here has, and takes it back once a description - a starter, or a
broker producer - reads the call. An undescribed one keeps it.

---

## Annotations

From `@flowatlas/markers`, for the places static reading is blind. An annotated
edge is recorded with `confidence: "marker"`, so it is always clear which edges
were told rather than found.

```ts
import { CallsService } from '@flowatlas/markers';

@CallsService('admin-api', 'POST /orders')
async submit(order: Order) {
  return this.transport.send(this.route, order);
}
```

Code that takes no decorator — a function, a worker's handler, a browser
method — says the same thing in its documentation comment:

```ts
/** @flowatlas-calls catalog GET /items */     // a service, a verb and a path
export const loadItems = (path: string) => fetch(path);

/** @flowatlas-calls GET /orders */            // browser only: no service
orders(path: string) { return this.http.get(path); }
```

The service is a configured name or one of its `services[].aliases`. On a
browser method or function (Angular and React) it is asked before `apiTarget`
or anything else, and the request joins there or is a `marker-service-unknown`
/ `marker-route-not-found` row; without a service the request goes wherever its
settings key says, as a read address would. The server readers take only the
form with a service. A tag is read on one line, and one with no verb in first
or second place names no request.

An annotation wins over what the settings key would have said, and adds no
second edge. One naming a service or a route that does not exist is reported and
the automatic answer is kept, so a stale annotation degrades rather than lies.

**Naming more than one.** `@Emits`, `@Consumes` and the routes of
`@CallsService` take a name, several names, or a list of them, and all of the
forms mean what a stack of single annotations means:

```ts
import { CART_CHANNELS } from '@acme/events';   // ['cart:joined', 'cart:left'] as const

@Emits('cart:joined', 'cart:left')              // several arguments
@Emits(['cart:joined', 'cart:left'])            // a list written in place
@Emits(CART_CHANNELS)                           // a catalogue, read through the const
@CallsService('orders', 'POST /orders', 'GET /orders/:id')
```

A catalogue resolves whether or not it is `as const`, and whether or not it is
readonly: what matters is that the array is *written down* where the reader can
see it. One assembled — `[...BASE, 'cart:left']`, or `NAMES.map(...)` — is read
at run time and cannot be followed, and says so rather than resolving to
nothing. `@FlowEntry` takes exactly one name, deliberately: an entry point is
where one flow begins.

**An argument that names nothing is reported, never dropped.** `doctor` says
which of the three it was: `marker-unknown-arg` for an argument the resolver
could not follow, `marker-arg-not-a-name` for one that resolved to something
that is not a string or a list of them, and `marker-names-nothing` for an
annotation that was given arguments and named nothing by the end of them. An
annotation that fails quietly is worse than no annotation, because the person
who wrote it believes the tool agreed with them.

---

## Environment

| Variable | Does |
|---|---|
| `FLOWATLAS_PIN_<SERVICE>` | with `check --env` and `diff --env`: the ref a service runs, over the pins file and under `--pin`; the service name upper-cased, every character that is not a letter or digit `_` |
| `NO_COLOR` | any value turns colour off everywhere, the same as `--no-color` |
