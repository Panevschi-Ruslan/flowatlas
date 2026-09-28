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
| `--no-mcp` | off | skip registering the graph server |

The type of a repository is read from its manifest: `@nestjs/core` makes it
`nestjs`, `@medusajs/framework` or `@medusajs/medusa` makes it `medusa`, `next`
makes it `nextjs`, `express`, `fastify` and `koa` make it each of those,
`@angular/core` makes it `angular`, `react` makes it `react`, and anything else is
written as `unknown`. Those eight are every type there is. Hono and Telegraf have
no type of their own: they are frameworks the server reader finds inside a
repository whichever server type it is given, so a repository whose only
framework is Hono is
given any of the server types — `express` will do — and its routes are read. Where
the manifest names a framework there is no reader for — Nuxt, Remix, Vue or
Svelte — `init` says so by name, and `build` repeats it on that repository's line:

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
router and its API routes) and Medusa are rows of that description, read by one
walk, so the two cannot drift on what counts as a verb read or a file served at
no address (`fixtures/react-next`, `fixtures/medusa-fs-router`). A file-system
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

| Flag | Default | Does |
|---|---|---|
| `--config <path>` | found upward | which project to build |
| `--out <dir>` | the configured `output` | where the three files go |
| `--concurrency <n>` | processors minus one | how many repositories to read at once |
| `--service <name>` | every service | read only this one and take the rest from the cache. Repeatable |
| `--no-cache` | off | ignore the recorded file hashes and read everything again |
| `--watch` | off | keep running, rebuilding after every change |
| `--timing` | off | print how long each phase took, as JSON |
| `--skip-frontend` | off | leave out the services a frontend extractor reads |
| `--heap <megabytes>` | a share of the machine | heap limit for each repository read |
| `--json` | off | print the report as JSON instead of a summary |

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
  (`fixtures/next-hollow`).
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
(`fixtures/workspace-package-paths`).

### `flowatlas extract <repo>`

Reads one repository on its own, without joining. Useful for looking at what a
single service produces, and for a build that wants to parallelise itself.

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
| `--depth <n>` | `8` for `flow`, `3` for `impact` | how many hops to follow |
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
| `--out <file>` | `graph.html` beside the graph | where to write it |
| `--title <name>` | the folder holding the configuration | what to call the project on the page |

No server and nothing to install. Two typefaces come from Google Fonts, with a
fallback, so the page reads offline but is not free of a third party. The page opens on the
reconciliation, lists every way in, follows any one of them across service
boundaries, and has a tab each for every crossing and for everything that did not
join.

---

## Checking

### `flowatlas doctor`

What could not be read, what the annotations get wrong, what has drifted, and
whether any of it has grown since the baseline. Five sections over one built
graph; it reads no repository, so two runs over one graph say the same thing.

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
| Channels | `channel-dynamic`, `channel-const-unresolved`, `channel-from-config`, `consumer-handler-unresolved`, `payload-type-unknown` |
| Settings | `dynamic-config-key` |
| Bots and handler tables | `bot-handlers-not-found`, `dynamic-bot-trigger`, `entry-registry-unconfigured`, `registry-key-dynamic`, `registry-handler-anonymous`, `orphan-scene-decorator`, `orphan-update-decorator`, `wizard-step-conflict` |
| Annotations | `marker-route-not-found`, `marker-service-unknown`, `marker-unknown-arg`, `marker-arg-not-a-name`, `marker-names-nothing` |
| Declared services | `document-age` |

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
| `type` | string | required for a repository | which reader opens it: `nestjs`, `medusa`, `nextjs`, `express`, `fastify` or `koa` for anything with a server in it, `angular` or `react` for a repository that is only a browser. Anything else is skipped and `build` says which type to set |
| `baseUrlEnv` | string[] | `[]` | settings keys other services use to address this one |
| `apiBaseEnv` | string[] | found in the environment files | for a browser: which of its settings keys hold an address, when they are not found |
| `apiTarget` | object | `{}` | for a browser: which service each of those keys points at, as `{ "apiUrl": "admin-api" }` |
| `document` | object | none | a document that *declares* this service, for an end nothing here can read: `{ "kind": "openapi" \| "asyncapi", "path": … }`, path relative to this file |
| `openapi` | string | none | the older spelling of `{ "kind": "openapi", "path": … }`, still read |
| `tsconfig` | string | found in the repository | which TypeScript configuration to parse with |
| `bootstrap` | string | `src/main.ts` | the application entry file, when it is elsewhere |
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
| `output` | string | `.flowatlas` | where the three build outputs go |
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
| `db.localBaseClasses` | string[] | `[]` | classes of your own that behave like a repository, so calls through them are data access — including classes a workspace package of yours declares |
| `frontend.localClientClasses` | string[] | `[]` | classes of your own that make HTTP requests, so `get`/`post`/… called on them are requests |
| `broker.custom` | object[] | `[]` | an in-house message bus, described so its publishers and handlers are found |
| `entry.registries` | object[] | `[]` | a table of handlers you keep yourself, described so each registration is a way in |
| `entry.http` | object[] | `[]` | an HTTP framework nothing here ships an adapter for, described so its routes are read |
| `entry.procedures` | object[] | `[]` | a framework whose ways in are the keys of a tree of object literals, described so each one is read |

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
