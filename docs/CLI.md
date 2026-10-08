# Command reference

Every command, every flag, and what each one does. For what the tool is and why,
see the [README](../README.md).

Commands fall into three groups. **Setting up** writes the configuration and
registers the graph server. **Building** reads the repositories. **Asking** reads
the built graph and never touches a repository.

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

```sh
flowatlas link ../admin-api ../bot ../web
flowatlas link ../new-service --dry-run
```

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
`@remix-run/react` makes it `remix`, `express`, `fastify` and `koa` make it each of those,
`@angular/core` makes it `angular`, `react` makes it `react`, and anything else is
written as `unknown`. Those ten are every type there is. Hono and Telegraf have
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
of the name) and `[...rest]` is the rest of the path
(`fixtures/sveltekit-server-routes`). Remix's flat routes are one name per route,
its segments separated by dots - `app/routes/api.orders.$id.ts`, or a folder of
that name holding `route.ts` - where a leading underscore is a layout that adds no
segment, `$id` a param, `$` the rest of the path and a dot in brackets a literal
one; a `loader` answers GET and an `action` POST, and a route module with neither
is a page and says nothing (`fixtures/remix-flat-routes`). A file-system
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

`--install` merges rather than overwrites, so servers a repository already has
survive. It writes the bare `flowatlas` command when one is on your path and an
absolute path when none is, so it works with nothing installed.

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
  services/<name>/
    graph.json         one service's own graph, reused when it has not changed
    cache.json         that service's file hashes, for a server reader
```

`<name>` is the service's name, written so it is always one directory: lower-case
letters, digits, `-`, `_` and an inner `.` are kept, and anything else, an
upper-case letter included, is written as `%` and its code, so `@shop/Orders`
is `services/%40shop%2F%4Frders/`. Two services never share a directory, even on
a disk that ignores case. A service renamed or removed from the configuration
has its directory removed by the next build, when nothing but the build's own
files are in it.

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

Five of these follow the graph and share one set of flags. Four report on it and
share a different, smaller set. The difference is real: a command that reports on
the whole graph has no walk to bound, so it is not offered `--depth`.

### Shared by the walking commands

`flow`, `impact`, `channel`:

| Flag | Default | Does |
|---|---|---|
| `--detail <0-3>` | `1` | 0 identity only, 1 adds location, 2 adds metadata, 3 is answered at 2 |
| `--format <name>` | `tree` on a terminal, `json` in a pipe | one of `tree`, `json`, `mermaid` |
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
for pasting into a pull request, where it renders as a diagram.

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
matching nothing comes back with the nearest few.

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
| `--format <name>` | `text` | `text`, `json` or `markdown` |
| `--severity <level>` | `info` | least severe finding to show: `error`, `warning` or `info` |
| `--fail-on <level>` | `none` | exit 1 on a finding at this level or worse: `none`, `error`, `warning` |
| `--edge <key>` | every boundary | only this one, as `from\|type\|to` |
| `--service <name>` | every service | only boundaries this service is on either side of |
| `--direction <name>` | all three | only `request`, `response` or `payload` |
| `--depth <n>` | `contracts.depth`, else `3` | how far into nested shapes to compare |
| `--max-nodes <n>` | `150` | most findings to print; the file is always complete |
| `--out <dir>` | the configured output | where to write `contracts.json` |
| `--no-ignore` | off | report what `@ContractIgnore` excuses as ordinary findings |

Every run writes the whole report to `<output>/contracts.json`, whatever it
printed and whatever it exited with. Exit `0` means it ran and found nothing at
or above `--fail-on`; `1` means it did; `2` means it could not run at all.

Four kinds of finding, and the level each carries: `missing_required` and
`type_mismatch` are errors, `optionality_mismatch` is a warning, `extra_field`
is information. A named rule may soften a verdict and never sharpen one.

A boundary that could not be compared is not left out: it is listed under
`unchecked` with the reason and the thing to do about it, so "no errors" can be
read as "nothing broken" rather than "nothing looked at".

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
the reconciliation from the last build.

| Flag | Default | Does |
|---|---|---|
| `--format <name>` | `tree` on a terminal | `json` or `tree` |
| `--detail <0-3>` | `1` | how much of each row to show |
| `--service <name>` | every service | narrow to one |

### Shared by the reporting commands

`cycles`, `dead`, `config`, `hotspots`:

| Flag | Default | Does |
|---|---|---|
| `--format <kind>` | `table` | `json` or `table` |
| `--max <n>` | `150` | most rows, after which it says how many it cut |

These say `table` where the walking commands say `tree`, because the output is
rows rather than a shape.

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
| `--service <name>` | every service | narrow to one |

A route nothing calls gets the reason it ended up in the list, which is not the
same question as whether it is dead:

| Reason | What it means |
|---|---|
| declared public in the configuration | a pattern under `doctor.publicRoutes` covers it, so its callers are outside the project by decision |
| looks like a health or status probe | the last segment is `health`, `healthz`, `ping`, `readyz`, `metrics`, `status` and the like; whatever runs it is outside the graph |
| looks like an event stream | the last segment is `stream` or `sse`, or ends in `-stream`; a browser subscribing to one is not read yet |
| no `http_calls`/`hits` from any repo | nothing above applies, which is what this command is for |

Only the last segment of a path is read, so `/api/health` is a probe and
`/api/health/reports/:param` is a route like any other. `status` and `metrics`
are words a business API uses too, so they count only within two segments of the
root: `/api/status` is a probe and `/api/orders/:param/status` is a route. A
segment starting with `_` or ending in `-status` counts at any depth.

Rows are ordered by what they mean rather than by name — the ones nothing
explains first — so `--max` cuts the rows that say why they are here before it
cuts the rows that do not.

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

No server and nothing to install. Two typefaces come from Google Fonts, with a
fallback, so the page reads offline but is not free of a third party. The page opens on the
reconciliation and the Map, lists every way in, follows any one of them across service
boundaries, and has a tab each for every crossing and for everything that did not
join.

The **Map** tab is the whole project at the size of its services:

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
- **Details.** A box opens its details: a service's counts, ways in by kind,
  rows to act on, routes nothing calls, what it reaches and what reaches it,
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
- **Checks.** *check* marks, per box: rows to act on, channels with one end,
  routes nothing calls, services nothing could read, or services that reach
  each other at run time (a cycle, its links drawn red). The chips hide a kind
  of link.
- **The frame.** Drag or a wheel pans, ctrl or a pinch zooms, *Fit* shows it
  all; `F` or the button is full screen; Escape closes the details, then a
  one-box view, then full screen. The address keeps the view by name -
  `#map/s=<box>&l=<link>&f=<box>&t=<families toggled>&h=<kinds hidden>&m=<check>&p=1&d=1` -
  so a link opens the same view in the next build; a box it names that is gone
  is said. *Copy link*, and SVG and PNG export, as on the Graph tab.

The **Graph** tab draws the neighbourhood of one node rather than the whole
graph, which on a real project is ten thousand boxes and says nothing:

- **Choosing a focus.** Search over every node, by label, type, kind, service or
  file: `table orders` is the table called `orders`. Every way in on the left,
  and every node named in the Walk, Crossings and Not joined tabs, has a *show in
  graph* link beside it.
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
  guessed (`heuristic`), and dotted when an annotation or a document said so
  (`marker`, `declared`). An edge says its type only when hovered and around the
  open node, so a busy drawing is lines rather than words.
- **Plumbing is folded.** Guards, interceptors, pipes and middleware are not
  drawn as nodes: a way in carries a chip saying what runs in front of it
  (`2 guards · 3 interceptors · 1 pipe`). Clicking the chip, or `W` on the node,
  draws that chain beside it and folds it back again; the *plumbing* chip above
  the drawing draws all of it as ordinary nodes. A guard chosen as the focus
  shows the ways in it stands in front of.
- **Busy sides are grouped.** More than six neighbours of one type on one side
  of a node (the queries on a table, the publishers on a channel, the callers of
  a route) are drawn as groups: by service, then by the class that owns them,
  each a stack with its count. A level with more than eight groups shows the
  busiest seven and one group holding the rest. Clicking a group opens it in
  place, into its classes and then into its nodes; *Group again* under the
  drawing closes them all. Grouping comes before the cap, so a table with two
  hundred queries is a handful of groups, not "348 more". What lies past a
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
  `(order: OrderDto, dense?: boolean) → {opened: OrderDto}`), React components,
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
  *Who else uses this* with its count, *Open in Walk* for a way in, *Path from here*, *Path to here* and
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
  *Path to here* in the panel, or with *from* and *to* above the drawing and the
  search. Every shortest path is drawn, one column per step, with how many there
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
- **Moving around.** Drag or scroll to pan, pinch or ctrl+scroll to zoom, *Fit*
  to see it all. Double-click centres on a node. Arrow keys move between drawn
  nodes, a hop at a time to the side and within a column up and down; Enter
  opens a node or a group, `+` expands it, `O` draws who else uses it, `W`
  unfolds its plumbing. On a
  touch screen one
  finger pans, and two fingers pan and pinch to zoom. *Back* and *Forward* step
  through the focuses visited.
- **Full screen.** *Full screen*, or `F`, gives the drawing the whole window:
  the heading, the numbers, the service rail and the ways in step aside, and the
  details panel lays over the drawing from the right.
- **Escape closes one thing at a time, nearest first**: the search's list of
  nodes (or picking a path's end with it), then the details panel - the drawer
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
- **Filters.** The service rail at the top hides a service's nodes here as it
  does its ways in; chips hide an edge type or a confidence, so the drawing can
  show, for instance, only what was guessed. The line under the drawing says
  which filters are on.

A link carries the page's own address, which for a file on disk is that file's
path: it opens on the machine that has the file, at that path.

---

## Checking

### `flowatlas doctor`

What could not be read, what the annotations get wrong, what has drifted, and
whether any of it has grown since the baseline. Five sections over one built
graph; it reads no repository's source, so two runs over one graph say the same
thing. It looks at a repository only to say whether its dependencies are
installed, and what a service with no way in looks like.

| Flag | Default | Does |
|---|---|---|
| `--section <name>` | all five | `unresolved`, `markers`, `desync`, `contracts`, `baseline`; repeatable |
| `--service <name>` | every one | narrow every section to one repository |
| `--strict` | off | exit 1 on a broken annotation, a contract error, or growth past the baseline |
| `--accept` | off | write today's numbers as the baseline |
| `--baseline <path>` | `<config dir>/flowatlas.baseline.json` | where the accepted numbers live |
| `--no-baseline` | off | skip the growth check, so `--strict` asks only about annotations and contracts |
| `--no-contracts` | off | do not run the contract check |
| `--max-nodes <n>` | 6 per reason | most places named under one reason; the written file is always complete |
| `--format <name>` | `text` | `text`, `json`, `github` |
| `--out <dir>` | configured output | where `doctor.json` goes |

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

The exit code is decided by the first of these that applies: a graph that cannot
be reported on, a baseline that cannot be read, or `--strict` with no baseline
(2); `--strict` and a check that found something (1); otherwise 0.

Every unresolved row is read at one of three levels, and only the first two say
the graph is missing something:

| Level | What it means | Counted in the total |
|---|---|---|
| `action` | a setting, an annotation or a registration would close it | yes, and `--strict` compares it |
| `info` | an edge is there and static reading cannot see it | no; reported beside the total |
| `nothing` | no edge exists to draw — a template binding that assigns to a field has no method behind it | no; reported on its own line |

`build` says the same thing in its last line: the rows it could not read, then
the places where nothing joins, never added together.

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
| Types | `type-unresolved`, `type-generic-uninstantiated`, `type-depth-exceeded`, `di-type-unresolved`, `decorator-arg-dynamic` |
| Injection and calls | `di-token-unknown`, `di-token-ambiguous`, `inject-token-unresolved`, `call-dynamic-receiver`, `call-module-ref`, `call-through-token`, `global-wrapper-dynamic` |
| NestJS applications | `bootstrap-not-found`, `application-root-unread`, `module-controllers-unread`, `module-import-dynamic`, `middleware-route-dynamic` |
| Routes and their addresses | `route-path-dynamic`, `route-mount-unread`, `route-registry-unread`, `route-file-not-served`, `route-verb-unread`, `route-handler-unread`, `route-handler-anonymous`, `server-action-unread`, `middleware-matcher-unread` |
| A described framework that matched nothing | `entry-http-description-inactive`, `entry-http-types-unmatched`, `entry-http-routes-unmatched`, `entry-http-routes-unplaced`, `entry-procedures-description-inactive` |
| Procedures | `procedure-router-unread`, `procedure-key-dynamic`, `procedure-branch-unread`, `procedure-trees-unmatched`, `procedure-members-unmatched`, `procedure-path-dynamic`, `procedure-not-found`, `procedure-ambiguous`, `procedure-call-mismatch` |
| Requests between services and from a browser | `dynamic-http-url`, `unknown-base-url-env`, `target-route-not-found`, `ambiguous-route`, `ambiguous-route-application`, `ambiguous-route-target`, `route-wildcard-only`, `route-mount-assumed-empty`, `api-path-dynamic`, `api-method-dynamic`, `api-base-unknown`, `api-base-override-unread`, `api-client-unread` |
| The gate in front of a route | `route-unguarded`, `route-guard-skipped`, `route-shadowed` |
| Screens and templates | `route-config-unread`, `route-loader-unread`, `route-link-dynamic`, `route-screen-unread`, `route-target-unresolved`, `handler-not-found`, `handler-not-a-method`, `template-not-found`, `template-not-parsed` |
| The data layer | `unknown-db-package`, `db-receiver-name-only`, `db-layer-unread`, `db-handover-unstated`, `db-package-unread`, `db-call-at-module-level`, `dynamic-table-name`, `sql-parse-failed`, `unknown-db-operation`, `dynamic-cache-key` |
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
| Subscribers declared in Terraform | `subscription-source-unread`, `subscription-target-unread` (info for a target of a kind nothing follows), `subscription-forward-unread` (info), `event-pattern-unread`, `subscription-matches-nothing` (info) |
| Values a deployment gives the code | `environment-not-set`, `environment-value-unread` |

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

### `flowatlas diff <base-ref> [head-ref]`

Builds the graph at two revisions and reports what moved: which nodes changed,
which entry points in which repositories reach them, and which contract findings
are new. Markdown by default, because its destination is a pull request comment.

| Flag | Default | Does |
|---|---|---|
| `--service <name>` | every one | compare only this repository, repeatable |
| `--format <name>` | `markdown` | `markdown` or `json` |
| `--output <file>` | none | write what was printed here as well |
| `--fail-on-contract-break` | off | exit 1 on a new contract error, or on a service neither ref could be read for |
| `--max-entries <n>` | 20 | ways in listed per changed node |
| `--max-nodes <n>` | 50 | changed nodes walked backwards from |
| `--concurrency <n>` | cores | repositories read at once |
| `--no-cache` | off | read every commit again rather than believing the cache |
| `--keep-worktrees` | off | leave the detached checkouts on disk, for debugging |
| `--out <dir>` | configured output | where `diff.json` goes |

Each service is read at the ref **in its own repository**. A service that is a
subdirectory of a repository rather than the root of one cannot be read at a
ref: the run says so in Warnings, the verdict names it, and
`--fail-on-contract-break` refuses rather than passing a comparison that did not
cover it.

### `flowatlas cache <action>`

The graphs `diff` keeps per commit, so comparing the same base twice reads it
once. `ls`, `prune` or `clear`.

| Flag | Default | Does |
|---|---|---|
| `--out <dir>` | configured output | the output directory holding the cache |
| `--keep <n>` | 10 | entries `prune` keeps, newest first |
| `--max <n>` | all | most rows to print |
| `--json` | off | print the answer as JSON |

---

## Configuration

Every key of `flowatlas.config.json`. Only `services` has no default.

### `services[]`

| Key | Type | Default | Means |
|---|---|---|---|
| `name` | string | required | what this service is called everywhere else |
| `repo` | string | required unless `document` is given | path to the repository, relative to this file or absolute. A service has a `repo` or a `document`, never both |
| `type` | string | required for a repository | which reader opens it: `nestjs`, `medusa`, `nextjs`, `sveltekit`, `remix`, `express`, `fastify` or `koa` for anything with a server in it, `lambda` for functions whose ways in are declared in Terraform, `angular` or `react` for a repository that is only a browser. Anything else is skipped and `build` says which type to set |
| `baseUrlEnv` | string[] | `[]` | settings keys other services use to address this one |
| `apiBaseEnv` | string[] | found in the environment files | for a browser: which of its settings keys hold an address, when they are not found |
| `apiTarget` | object | `{}` | for a browser: which service each of those keys points at, as `{ "apiUrl": "admin-api" }` |
| `document` | object | none | a document that *declares* this service, for an end nothing here can read: `{ "kind": "openapi" \| "asyncapi", "path": … }`, path relative to this file |
| `openapi` | string | none | the older spelling of `{ "kind": "openapi", "path": … }`, still read |
| `tsconfig` | string | found in the repository | which TypeScript configuration to parse with |
| `bootstrap` | string | `src/main.ts` | the application entry file, when it is elsewhere |
| `infra.vars` | string[] | none | for a service read from Terraform: the variable files a deployment is read with, in order, relative to the service's directory (`["infra/env/dev.tfvars"]`). Without it, a name two files set differently is reported, never picked |
| `readTestDirectories` | string[] | `[]` | directories named like tests (`test`, `tests`, `e2e`, `fixtures`, `cypress`, `playwright`, `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`) that hold code the application runs, relative to the service's directory: `["src/fixtures"]` |

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
| `output` | string | `.flowatlas` | where everything a build writes goes, relative to this file: the three outputs, the cache and each service's own graph under `services/`. Nothing is written into the repositories |
| `types.maxDepth` | number | `3` | how deep an anonymous shape is written out before it becomes a reference |
| `contracts.depth` | number | `3` | how far into nested shapes `flowatlas contracts` compares |
| `contracts.rules.disable` | string[] | `[]` | rules about the JSON wire this project's wire does not follow |
| `contracts.ignoreEdges` | string[] | `[]` | boundaries whose drift is deliberate, as `from\|type\|to`, for code you cannot annotate |
| `doctor.baseline` | string | `flowatlas.baseline.json` beside this file | where the accepted numbers live, relative to this file |
| `doctor.ignoreReasons` | string[] | `[]` | reasons left out of the growth check. Their rows are still printed; only the number `--strict` compares is quieter. A renamed reason's old spelling is still recognised |
| `doctor.markers.warnAsError` | boolean | `false` | fail a strict run on a redundant annotation as well as a false one |
| `doctor.publicDecorators` | string[] | `["Public", "IsPublic", "AllowAnonymous", "SkipAuth"]` | decorators that mark a handler public on purpose, so `route-unguarded` leaves it out |
| `doctor.publicRoutes` | string[] | `[]` | routes public by decision, as `METHOD /path` with `*` for any run of characters (`* /api/health`, `GET /api/public/*`) |
| `doctor.nonGateWrappers` | string[] | `["ThrottlerGuard"]` | guards that refuse nobody for who they are, so a route behind only these is still `route-unguarded` |
| `doctor.skipGuardDecorators` | object | `{}` | decorators that switch a guard off for one handler through the reflector, each mapped to the guard classes it switches off (`{"SkipTenantAuth": ["TenantAuthGuard"]}`; `[]` = every guard); a route carrying one is audited as if those guards were absent |

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
written down a second time under `doctor.publicRoutes`), `route-shadowed` (a
route a worker answers before the
application, whose guards then never run) and `route-wildcard-only` (a request
only a catch-all route answers). Accept them into the baseline once reviewed;
`--strict` then fails only on new ones.

**`/** @flowatlas-auth <how> */`.** Some handlers refuse a request in their own
body — a signed header resolved inside the method, a service token checked by
hand — and no guard sits in front of them because none should. Static reading
cannot see any of that. The annotation on the handler says so in one line, and
the route audit then says nothing about it. Like every marker it is
unverifiable: it is worth what whoever wrote it is worth, and it is the same
bargain `@flowatlas-calls` offers for an address built at run time.

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

`contracts.json` is at format version 4: a party may carry `writes`, a finding
may carry `impact`, a request-direction message distinguishes what a call sends
from what its type permits, an `impact` may read `unread` as well as the three
words version 2 knew, and a party may carry `declaredBy`, naming the document an
end nobody here could read was taken from.

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

### `adapters`

| Key | Type | Default | Means |
|---|---|---|---|
| `auto` | boolean | `true` | detect which adapters apply from each repository's manifest |
| `force` | object | `{}` | use these adapters regardless of what was detected |
| `db.localBaseClasses` | (string \| object)[] | `[]` | classes of your own that behave like a repository, so calls through them are data access — including classes a workspace package of yours declares. An entry may be `{ "name": "BaseRepository", "tableProperty": "collectionName" }` to say which property each class extending it sets to its table |
| `db.tables` | object[] | `[]` | functions your data access goes through that name their table at the call — `insert('orders', row)` from a data kit of your own, installed or not: `{ "name", "package"?, "table": argIndex \| "name", "op"?: "read" \| "write" \| "delete" }` (see [Tables named in configuration](#tables-named-in-configuration)) |
| `frontend.localClientClasses` | string[] | `[]` | classes of your own that make HTTP requests, so `get`/`post`/… called on them are requests |
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

`class MenuRepository extends BaseRepository<MenuItem> { protected readonly
collectionName = 'menuItems'; }` makes every call through a `MenuRepository`
a query on `menuItems`, whether the value is a literal or a constant; the class
itself first, then each class it extends. The stated name wins over the type
argument. Inside such a class, a query made through `this` whose chain names no
collection is on the class's own table: `const c = await this.coll();
c.find(…)` in `MenuRepository` is a query on `menuItems`. A query written inside
the base itself runs for every class that extends it, so it has no one table; it
is an `info` row saying so, and each call through a subclass carries that
subclass's table. A base named as a plain string
keeps working as before, and a query through it whose table is not read carries
a row naming `tableProperty` as the key that would read it
(`fixtures/nest-mongo-tables`).

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
name, under any local name, or on a namespace or default import of the package
- so nothing has to be installed, and a local of the same name that shadows the
import is not it; one without is matched by a declaration of that name in the
repository. The table is the string at argument `table`, written in place or
through a constant, or `table` itself when it is a name. The query is recorded
with `source: "configured"` and `declared` confidence; a table the argument
does not name as a string keeps the query and gets a `dynamic-table-name` row
(`fixtures/data-kit-tables`).

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

### The AWS SDK

Publishing through EventBridge, SQS and SNS is read without configuration, from
`@aws-sdk/client-eventbridge`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sns` and
`aws-sdk` (version 2). The package may be declared in the repository's own
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

A channel is named by the deployed name, never by the URL or ARN the code holds:
`https://sqs.eu-west-1.amazonaws.com/111122223333/returns` is `sqs/returns`, and
a bus's ARN is the bus's name. The service comes first because a queue and a topic
are often given the same name and are not the same channel. A subscriber read from
the deployment arrives at the same name, so the two meet on one node.

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
`kit.respond` on a namespace or default import of it - so the package does not
have to be installed; one without is matched by a declaration of that name in
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
| the same from a DynamoDB table's stream or a Kinesis stream | an `event` entry, `dynamodb/<table>` or `kinesis/<stream>`, on the function |
| `aws_sns_topic_subscription` with protocol `lambda` or `sqs` | a consumer of `sns/<topic>` reaching the function or the queue; any other protocol is read and not followed (`info`) |
| `redrive_policy` on `aws_sqs_queue`, and `aws_sqs_queue_redrive_policy` | a `triggers` edge from the queue to a publisher onto its dead-letter queue — not a reader, so a queue nothing reads is still one `dead` reports |
| `aws_pipes_pipe` | a consumer of its source reaching its target; a bus target with `eventbridge_event_bus_parameters` publishes exactly that event |
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
a rule on that bus matches them in turn (`fixtures/lambda-terraform-bus-forward`). Each is named by a reference to what the
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

`terraform-aws-modules/eventbridge/aws`, `terraform-aws-modules/sqs/aws` and
`terraform-aws-modules/sns/aws` ship described, beside the function and route
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
  and transaction calls) is a `db_query` on that table.
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
