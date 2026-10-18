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
No reader yet for 13 repositories: Vue (9), the Serverless Framework (4).
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
`express`, `fastify` and `koa` make it each of those,
`@angular/core` makes it `angular`, `react` makes it `react`, and anything else is
written as `unknown`. Those eleven are every type there is. Hono and Telegraf have
no type of their own: they are frameworks the server reader finds inside a
repository whichever server type it is given, so a repository whose only
framework is Hono is
given any of the server types — `express` will do — and its routes are read. Where
the manifest names a framework there is no reader for — Nuxt, Vue or Svelte
without SvelteKit — `init` says so by name, and `build` repeats it on that repository's line:

```
web            skipped (no-extractor: Nuxt, no reader yet)
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

**A file-system router is four values.** Where the address is the path of a file
rather than an argument of a call, what differs between one router and another
is the root directory, which file names declare a route, the prefix in front,
and which segment spellings are honoured. Next.js (the app router, the pages
router and its API routes), Medusa, SvelteKit and Remix are rows of that
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
`--watch` rebuild included; a new directory beside the configuration does not
start a rebuild by itself, and the next save in a repository does.

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
itself - a likely N+1, a route with no guard). The build ends on one line that
counts them apart, never added together:

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

`flow`, `impact`, `channel`:

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
`procedure-input-by-name` and `procedure-output-inferred` (see *What is not
compared, and says so* under [Top level](#top-level)), and the
delivered-message reasons in the table further down.

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
kind, service or file, the way the Graph tab's own search found them (`table orders`
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
$ flowatlas observe traces/checkout.otlp.json traces/billing.observe.json traces/billing.batches.observe.json
70 spans read from 3 file(s)
not read: 1 snapshot of protocol ws, 1 node without o, c and m, 1 job without a span tree
3 joins seen, 6 entries hit, 6 seen at run time but not found in code, 1 that could be more than one place
  db        billing  invoices  (2)
  client    billing  GET /orders/:value  (1)
  code      billing  LedgerClient.post  (1)
  http      billing  GET /healthz  (1)
  http      gateway  GET /metrics  (1)
  messaging orders  order.audited  (1)
could be more than one place, so counted on none:
  client    gateway  GET /orders/:value  (1)
    any of http_out:gateway#src/clients/orders.client.ts:33:12, http_out:gateway#src/clients/orders.client.ts:59:12
slowest entries (p95):
  gateway GET /orders/:param  count 2  p50 47.26ms  p95 520ms  max 520ms  errors 0%
  orders GET /orders/:param  count 1  p50 496ms  p95 496ms  max 496ms  errors 0%
  orders POST /orders  count 1  p50 35ms  p95 35ms  max 35ms  errors 100%
  billing event order.created  count 1  p50 12ms  p95 12ms  max 12ms  errors 0%
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
is):

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
- **@nestjs/observe** telemetry batches, the JSON the SDK (0.3.x) posts to its
  endpoint: `{ serviceId, snapshots, jobs, ... }`, a saved series of posts
  `{ batches: [ ... ] }` (read one after another), or a bare array of request
  snapshots exported by hand. Read: `serviceId` (else `--service`); per
  snapshot `ti` trace id, `ct` time, `d` duration, `e` (an error, read as
  *it failed*), `p` protocol, `op` the route the router matched, `a.m` method,
  `a.sc` status and the path of `a.ou`; and the span tree in `t`, whose nodes
  need `o`, `c` and `m` and give `d` and `e` too. A node of class `http` is an
  outgoing request (`http.method` and the path of `http.url`); one of class
  `mongodb`, `pg` or `mysql2` names its collection as the second word of `m`;
  any other is the method `c.m`. Only `http` and `https` snapshots are read as
  requests; a job is read for its span tree.
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
- **A browser's HAR** (P112): the Network tab's *Save all as HAR*, the record
  of exactly the calls a front end makes into its API. Each call a script made
  (`_resourceType` `xhr` or `fetch`; where the browser does not write it, a
  JSON answer, or no answer type for a method other than `GET`) is a client
  span of the front end: method, the path's shape, `response.status` (`0`, a
  call the browser blocked or cancelled, is *it failed* with no status),
  `time` and `startedDateTime`. Scripts, styles, images, fonts and pages are
  skipped and counted. The front end is `--service`, else the one service the
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
  key starting `_` but `_resourceType`; the query and fragment are cut before
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
`not read: 1 snapshot of protocol ws, 1 node without o, c and m`.

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
`response.content.text` (base64-decoded when `encoding` says so), a
@nestjs/observe snapshot's `rq.body` - and keeps their **shape**: key names,
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

and the @nestjs/observe agent's endpoint setting at `http://127.0.0.1:4318`
(it posts its batches to `/applications/telemetry`). What it answers is what
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
`reasons` is the `--reason` list it was narrowed to, or `null`).

**The repository that is probably missing.** The commonest reason for a request
no service claims, a package nobody installed and a channel with one end is one
repository nobody added to the configuration. Each of those is read from the
graph as evidence, with the name it points at:

| Evidence | From | Name |
|---|---|---|
| a setting | an `unknown-base-url-env` row no service claims (`PAYMENTS_URL`, `paymentsApi`) | its words less `_URL`, `_HOST`, `_BASE`, `Api`, `Service`: `payments` |
| a host | a third party written in the call, or a value of such a setting, whose host is the project's own: no dot, `localhost:<port>`, a private address, `*.internal`, `*.local`, `*.svc`, `*.cluster.local`, or a name under a domain a service's `hosts` uses | its first label, a cluster's service name, or the host itself for `localhost:<port>` |
| a package | `module-not-installed:<package>`, under the scope of a configured service's own `package.json` name, that no read repository is | without its scope and its `-client`, `-sdk`, `-types` |
| a channel | `channels.noConsumers` / `noProducers` | its first segment (`payment.captured` → `payment`), its transport's word left off (`sqs/…`) |
| a deployment | `invoke-target-not-found`, `route-root-not-found`, `function-handler-not-found` | the deployed name's service part, its stage word and its own last word left off |
| traffic | with an observed file beside the database: a `seen-not-in-code` blind spot (what `observe` matched to nothing) whose `service.name` no configured service has; or a `peer` blind spot, a call whose `peer.service` names a service the map lacks (P146), from any service | the service's name; for a `peer` row, each name the calls went to (a masked `:value` is none) |

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
Probably missing: a repository for "payments" — 3 kinds of evidence, 4 places
  PAYMENTS_URL is used by gateway (2 requests) and no service claims it
  @acme/payments-client is imported by orders and is not installed
  channel payment.requested is published by orders and nobody here consumes it
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
configuration; `weak` for a lone package or channel with nothing on disk);
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
deployment written for a tool nothing reads (the Serverless Framework, AWS SAM,
the AWS CDK), a framework nothing reads, a framework that *is* read under
another type, or a library:

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
| NestJS applications | `bootstrap-not-found`, `application-root-unread`, `module-controllers-unread`, `module-providers-unread`, `module-import-dynamic`, `middleware-route-dynamic`, `fails-filter-unread` |
| Routes and their addresses | `route-path-dynamic`, `route-mount-unread`, `route-registry-unread`, `route-file-not-served`, `route-claimed-twice`, `route-module-not-found`, `route-verb-unread`, `route-handler-unread`, `route-handler-anonymous`, `server-action-unread`, `middleware-matcher-unread` |
| A described framework that matched nothing | `entry-http-description-inactive`, `entry-http-types-unmatched`, `entry-http-routes-unmatched`, `entry-http-routes-unplaced`, `entry-procedures-description-inactive` |
| Procedures | `procedure-router-unread`, `procedure-key-dynamic`, `procedure-branch-unread`, `procedure-trees-unmatched`, `procedure-members-unmatched`, `procedure-path-dynamic`, `procedure-not-found`, `procedure-ambiguous`, `procedure-call-mismatch` |
| Requests between services and from a browser | `dynamic-http-url`, `unknown-base-url-env`, `service-binding-unknown`, `target-route-not-found`, `ambiguous-route`, `ambiguous-route-application`, `ambiguous-route-api`, `route-api-guessed`, `base-url-from-files`, `base-url-from-name`, `ambiguous-route-target`, `route-wildcard-only`, `route-mount-assumed-empty`, `api-path-dynamic`, `api-method-dynamic`, `api-base-unknown`, `api-base-override-unread`, `api-client-unread` |
| The gate in front of a route | `route-unguarded`, `route-guard-skipped`, `route-checked-in-body` (info), `route-public-declared` (info), `marker-reason-missing` (info), `route-shadowed` |
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
| `--format <name>` | `markdown` | `markdown`, `json` or `sarif` (the new and fixed contract findings and rule violations, [SARIF](#--format-sarif-findings-for-code-scanning)) |
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
| `x-flowatlas-sources` | response | `throw`, `guard`, `pipe` |
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
| `type` | string | required for a repository | which reader opens it: `nestjs`, `medusa`, `nextjs`, `sveltekit`, `remix`, `react-router`, `express`, `fastify` or `koa` for anything with a server in it, `lambda` for functions whose ways in are declared in Terraform, `angular` or `react` for a repository that is only a browser. Anything else is skipped and `build` says which type to set |
| `baseUrlEnv` | string[] | `[]` | settings keys other services use to address this one |
| `apiBaseEnv` | string[] | found in the environment files | for a browser: which of its settings keys hold an address, when they are not found |
| `hosts` | string[] | `[]` | hosts this service is reached at, as `host` or `host:port` (`["orders.example.com"]`), for a base address read from a repository's files to be matched against beside the service's name |
| `aliases` | string[] | `[]` | other names the service is known by: the short name an annotation uses (`@CallsService('catalog', …)` for `catalog-api`), the name its worker is deployed under (a service binding's target), a host. Wherever a service is named — an annotation, `apiTarget`, a binding, a base address's host — an alias is the service. Unique across every name and alias; matched exactly, never by prefix |
| `tags` | string[] | `[]` | names an architecture rule can select the service by: `frontend`, `edge`, `domain:payments`. A tag is a name only; nothing is inferred from it ([`rules`](#rules)) |
| `catalog` | object | none | what a software catalogue says of the service and the code cannot, for [`export`](#flowatlas-export-backstagestructurizr): `{ "owner", "lifecycle", "system", "description", "sourceUrl" }`, every key optional. Written as given; an owner or lifecycle nobody gave is `unknown`, and nothing is guessed from the code |
| `apiTarget` | object | `{}` | for a browser: which service each of those keys points at, as `{ "apiUrl": "admin-api" }` |
| `document` | object | none | a document that *declares* this service, for an end nothing here can read: `{ "kind": "openapi" \| "asyncapi", "path": … }`, path relative to this file |
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
| `settingFiles.environment` | string | none | the environment read where files name several (`.env.development` and `.env.staging`, `docker-compose.prod.yml`, a worker's `env.<name>.vars`): that environment's files, and the files for none in particular |
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
under `unchecked` with the reason, never counted as agreeing. A procedure is one:
its input is recorded on the entry by the name it was written under, and a real
input is nearly always a validation schema whose type is the library's inference,
so the request half is unchecked as `procedure-input-by-name`, and the answer,
which the client infers from the server's own tree, as
`procedure-output-inferred`. A handler that takes
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
| `only: { from, to, via?, op? }` | nothing outside `from` may reach `to` | a hop into `to` from a node `from` does not select; `op` (`read`, `write`, `delete`) narrows a table's queries |
| `tags: { source, mayReach, via? }` | a service tagged `source` may join only services carrying one of `mayReach` (`*` any) | a hop from such a service into one carrying none of them; a consume joins the services that publish onto the channel, a publish joins nobody in particular |
| `reachable: { from, to, must }` | with `must: true`, a path from `from` to `to` must exist | `true`: no path any more (one violation, with no hop to point at). `false`: every path that does |

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
own error classes; `guard` for a guard's refusal; and `pipe` for the
framework's pipes on the route or on a parameter (400). A throw caught in the
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

The only infrastructure reader is Terraform. SAM, the Serverless Framework, the
CDK and CloudFormation are named when a repository is written for one
(`deployment-unread`), and are a second implementation of the reader interface
the adapter is written against, not a change to it.

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
names its function even though neither the region nor the account is known.

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
| `FLOWATLAS_DB` | the database `flowatlas-mcp` reads, when no flag says otherwise |
| `NO_COLOR` | any value turns colour off everywhere, the same as `--no-color` |
