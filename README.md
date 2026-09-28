# flowatlas

[![check](https://github.com/Panevschi-Ruslan/flowatlas/actions/workflows/check.yml/badge.svg)](https://github.com/Panevschi-Ruslan/flowatlas/actions/workflows/check.yml)
[![npm](https://img.shields.io/npm/v/@flowatlas/cli)](https://www.npmjs.com/package/@flowatlas/cli)
[![node](https://img.shields.io/node/v/@flowatlas/cli)](https://nodejs.org)
[![licence](https://img.shields.io/npm/l/@flowatlas/cli)](LICENSE)

One map of a project that lives in several repositories.

**A command-line tool that reads several TypeScript repositories with the
compiler's own checker, without running them, and joins them into one graph you
can query — from a terminal or from a coding agent over the Model Context
Protocol.** It knows NestJS and Angular, React and Next.js, Express, Fastify,
Koa and Hono, Medusa, tRPC and Telegraf; TypeORM, Prisma, Drizzle, Mongoose,
Sequelize, Kysely, Knex, MongoDB and node-postgres; Redis, Kafka, RabbitMQ,
BullMQ and socket.io; and OpenAPI and AsyncAPI documents for the services whose
source you do not have.

Each repository is read on its own, then the readings are joined: a request made
in one service is matched to the route that answers it in another, a message
published in one is matched to whatever handles it, and a button in a browser is
matched to the endpoint it calls. The result is a single graph you can walk from
a click to the collection it writes.

```sh
npm install -g @flowatlas/cli
flowatlas init --dir .   # find the repositories under here
flowatlas build          # read them all and join them
flowatlas doctor         # what it could not read, and the one thing to change
```

### Why not the tools you already have

`madge`, `dependency-cruiser` and `nx graph` draw the imports inside one
repository, which is the thing a compiler can already see. Nothing in a
repository's import graph says that `this.http.get(this.config.get('ORDERS_URL')
+ '/orders/' + id)` in the gateway reaches `@Get(':id')` in a different
checkout. That join is the whole of this tool; the rest of the graph exists to
make it reachable from both ends.

If your project is one repository, you do not need this.

---

## Why it exists

A service in isolation is readable. Five services are not, and no single
repository contains the answer to the questions that actually matter:

- If I change this method, which routes break, and whose?
- Which service calls this endpoint, and does it still exist?
- Who handles this event, and does anyone?
- Which settings does this one request actually depend on?
- What does the browser call that the server no longer serves?

A person answers these by grepping across checkouts and holding the result in
their head. An agent cannot do even that, because it only sees the repository it
is sitting in. flowatlas answers them from one graph, and offers that graph to an
agent over the Model Context Protocol so a session working in one repository can
reason about all of them.

---

## Measured on a real project

Five repositories that ship as one product: three NestJS services and two Angular
frontends, with a shared package of types between them. It is the project this
was built against, which is worth knowing when you read the numbers: they are
reproducible, and they are from one codebase whose author also wrote the tool.
Measured with 0.4.0.

| | |
|---|---|
| Source read | 1,523 files, 259,337 lines of TypeScript and templates |
| Cold build | 5.5 s |
| Rebuild with nothing changed | 1.0 s |
| Graph | 11,352 nodes, 19,825 edges |
| **Edges that cross a repository boundary** | **542** |

That last row is the point. Five hundred and forty two connections that no
compiler in any of those five checkouts can see, because each one only ever
reads its own.

**Where the edges come from.** 19,406 were read from the code, 397 were
inferred and marked `heuristic`, and 22 were declared by an annotation. Every
edge says which of the three it is.

**Ways in.** 564 HTTP routes, and 64 more through a bot: 13 commands, 45 button
callbacks, 6 events. Something in the project reaches 507 of the routes. Nothing
it can see calls the other 57 — and of those, 12 are declared public in the
configuration and 7 look like health probes, which leaves 38 worth a look.

**What joined across the boundaries.** Two columns, because the first build of
any project is not the one to judge it by and quoting only the second would be
selling you something:

| | first build | configured |
|---|---|---|
| Browser requests matched to the route that answers them | 493 of 499 | 493 of 499 |
| Calls between services matched to a route | **1 of 61** | 41 of 61 |
| Routes something in the project reaches | 481 | 507 |
| Message channels with a handler | 0 | 7 of 17 |

The configuration behind the second column names the settings key that
addresses a service (`baseUrlEnv`), the key a frontend's requests are rooted at
and where it points (`apiBaseEnv`, `apiTarget`), and the shared package of
types (`sharedPackages`). Nothing can work those out for you: a string in one
repository and a route in another are joined by a fact only the person who
deployed them knows. `flowatlas doctor` names what is missing, with the file and
the line that wants it.

**What each version changed, on the same repositories.** The same configuration
and the same commit of every repository, read by each:

| | 0.1.1 | 0.2.0 | 0.3.0 | 0.4.0 |
|---|---|---|---|---|
| Browser requests found | 343 | 495 | 499 | 499 |
| …matched to the route that answers them | 318 | 489 | 493 | 493 |
| Routes nothing appears to call | 220 | 62 | 58 | 57 |
| Edges that cross a repository boundary | 366 | 537 | 541 | 542 |
| Boundaries a contract could be compared on | 337 | 636 | 636 | 636 |
| Contract errors | 37 | 1 | 1 | 0 |
| Contract warnings | 398 | 1,069 | 1,069 | 1,014 |
| Front ends asking for a route nothing serves | — | 2 | 1 | **0** |

Most of the first step is requests made through a wrapper — a pass-through
client, a base service whose resource a subclass decides — that 0.1.1 followed
as far as the wrapper and no further. The routes 0.1.1 reported as never called
were being called all along. The contract rows move in opposite directions on
purpose: nearly twice as many boundaries can be compared, several kinds of false
error were removed, and a request from a method nothing references is now a
warning rather than an error, because nothing proves it runs.

The second step is smaller and the same shape: the four streams the application
holds open, opened through a wrapper that remembers what it was given rather
than using it there and then, which is how a subscription survives being
backgrounded. The third is smaller again, and is mostly about saying true
things rather than reading new ones: the one contract error and the one route
the front end appeared to ask for and the back end appeared not to serve were
both false, and both are gone.

**What it found once they were joined.**

| | |
|---|---|
| Names declared more than one way in two repositories | 64 |
| Channels published to and handled nowhere | 10 |
| Contract errors, over 636 compared boundaries | 0 |
| Front ends asking for a route nothing serves | 0 |

**What it says it cannot see.** 22 findings to act on, and 387 places static
reading cannot reach at all, folded into 19 rows so the list stays readable.
None of it is guessed at; each row carries a file, a line and a reason.

A further 397 places are listed apart from both, because nothing joins them to
anything: a template binding that assigns to a field has no method behind it, in
this project or any other. They are places, not gaps, and adding them to the
figure above would make it say something untrue.

```sh
flowatlas stats     # the tables above, for your own project
flowatlas doctor    # the findings, grouped by reason, with what to change
```

---

## Install

Node 20 or newer.

```sh
npm install -g @flowatlas/cli
npm install -D @flowatlas/markers   # only if you annotate calls
```

The command is `flowatlas` whichever way you install it. To run it without
installing anything:

```sh
npx @flowatlas/cli build
```

From a checkout of this repository instead:

```sh
pnpm install
pnpm -r build
pnpm flowatlas <command>            # or: cd packages/cli && npm link
```

---

## Getting started

```sh
flowatlas init --dir .          # find the repositories under here and write the config
flowatlas build                 # read them all and join them
flowatlas flow "POST /orders"   # follow one request through
```

![one click in a browser, followed into a third repository](docs/media/04-flow.gif)

That is one button in an Angular template, followed through the gateway, into the
orders service, to the row it reads. Three repositories, and `unresolved on this
path: 0` says nothing along it was guessed.

[**The walkthrough**](https://panevschi-ruslan.github.io/flowatlas/) does the whole
thing from an empty directory, with a recording of every step. The same thing as
markdown is [docs/getting-started.md](docs/getting-started.md).

`init` writes `flowatlas.config.json`, works out each repository's name and kind
from its manifest, and registers the graph server in every one of them so an
agent in any repository can query the whole project. A repository that declares
a workspace is proposed as the applications in it, one service each, with the
packages they import read as part of whichever service declares them.

`flowatlas link ../admin-api ../bot ../web` is the same thing with the
repositories named rather than discovered, for when they are not all in one
place. Adding a sixth later is one more `link`.

> `init` with no `--dir` looks in the *parent* directory, which is what you want
> when the configuration lives inside one of the repositories. Pass `--dir .`
> when it lives above them.

`build` writes three files under the output directory, `.flowatlas` by default:

| File | What it is |
|---|---|
| `project-graph.json` | the whole graph, and the canonical artefact |
| `link-report.json` | what joined, what did not, and why |
| `graph.db` | the same graph as SQLite, which every query reads |

---

## Commands

### Building

| Command | What it does |
|---|---|
| `flowatlas link <repo...>` | put repositories into one project |
| `flowatlas unlink <name...>` | take them out again |
| `flowatlas init` | find repositories beside this one and ask |
| `flowatlas build` | read every repository and join them |
| `flowatlas extract <repo>` | read one repository on its own |

`build` reads each repository in its own process, records a hash per source file,
and skips a repository whose files have not moved. Useful flags:

```sh
flowatlas build --watch            # rebuild on every change, project held open
flowatlas build --service admin    # this repository, the rest from the cache
flowatlas build --skip-frontend    # servers only
flowatlas build --no-cache         # read everything again
flowatlas build --timing           # how long each phase took
```

On the 259,000-line project measured above: 5.5 seconds cold, one second when
nothing changed, about two seconds for a one-file edit under `--watch`.

### Asking

| Command | Answers |
|---|---|
| `flowatlas flow <entry>` | follow one way in through every service it reaches |
| `flowatlas impact <symbol>` | every entry point that reaches a symbol |
| `flowatlas channel <name>` | who publishes to a channel and who handles it |
| `flowatlas types [--drift]` | the type registry, and names two repositories disagree about |
| `flowatlas contracts` | what each service sends against what the other declares, field by field |
| `flowatlas stats` | what the graph is made of |
| `flowatlas cycles` | circular dependencies, cross-service ones first |
| `flowatlas dead` | entries, channels and providers nothing appears to reach |
| `flowatlas config <selector>` | the settings one flow depends on |
| `flowatlas hotspots` | what the most things point at |
| `flowatlas visualise` | the whole graph as one page you can open |

### Checking

| Command | Answers |
|---|---|
| `flowatlas doctor` | what could not be read, what the annotations get wrong, what has drifted |
| `flowatlas diff <base> [head]` | what a branch changes, who would notice, and what it breaks |
| `flowatlas cache <action>` | list, prune or clear the graphs `diff` keeps per commit |

`doctor` is the one to run after a first build. It groups every finding by
reason, and each row carries the file, the line and what to do about it:

```sh
flowatlas doctor --section desync      # calls that no longer match a route
flowatlas doctor --service gateway     # narrow every section to one repository
flowatlas doctor --strict              # exit 1 on a broken annotation or a contract error
flowatlas doctor --accept              # write today's numbers as the baseline
```

With a baseline, `--strict` fails only on growth, which is what makes it usable
on a project that starts with findings.

Some graphs are not worth a verdict, and `doctor` refuses them with exit 2
whatever flags it was given: a graph a failed build wrote, a graph with nothing
in it, one a service was read into and contributed nothing to, and one where most
of a service's ways in were read as far as their addresses and no further. In
each of those, every check would answer "nothing wrong" about code nobody read,
and a baseline accepted over them would accept the blindness.

Four of `doctor`'s findings are about the gate in front of a route rather than
the route itself: `route-unguarded`, a route with no guard or middleware in
front of it that reaches stored data; `route-shadowed`, a route a worker
answers before the application whose guards would have run; `route-wildcard-only`,
a request nothing but a catch-all serves; and `whitelist-strip`, a field sent to
a receiver whose whitelisting `ValidationPipe` removes it on arrival. Routes
that are public by decision go in `doctor.publicRoutes`, and a decorator that
switches a guard off through the reflector goes in `doctor.skipGuardDecorators`;
both are in [the command reference](docs/CLI.md). `diff` answers the other question a build
asks: given this branch, which entry points in which repositories would notice.
Its output is markdown because it is meant for a pull request comment, and
`--fail-on-contract-break` turns a new disagreement into a failure.
[docs/ci.md](docs/ci.md) is the whole recipe.

An entry can be named the way you would say it out loud. All three of these mean
the same route:

```sh
flowatlas flow "POST /orders/12345"
flowatlas flow "POST /orders/:param"
flowatlas flow "entry:orders:http:POST:/orders/:param"
```

A procedure is named by its id, `entry:api:rpc:orders.list`, and a service with
two applications serving one path puts the application in the id,
`entry:api@WorkerModule:http:GET:/health`; a shorter name that matches either
comes back with the ids to choose from.

`flow`, `impact` and `channel` take `--detail 0..3` and
`--format tree|json|mermaid`, so the same
walk is read in a terminal, parsed by a script, or pasted into a document as a
diagram. Every flag of every command is in the [command reference](docs/CLI.md).
Output is bounded and says what it cut:

```
12 more nodes, increase depth or narrow scope
```

The three are not interchangeable if something has to reason about the answer.
All render the same walk, but a tree is by far the cheapest to read, roughly a
twelfth of the JSON for the same trace, because JSON repeats every key and every
full node id. JSON is the one to use when a program parses it, since only it and
the server carry node ids. Mermaid names every edge and its confidence, so a
diagram is not lossy, but it drops locations and ids: it is for a person looking
at a pull request.

### Seeing it

```sh
flowatlas visualise                     # writes graph.html beside the graph
flowatlas visualise --out map.html --title "Ledger"
```

One file with the graph inside it: no server and nothing to install. It asks
Google Fonts for two typefaces and falls back to your own if it cannot reach
them, so it reads offline and is not free of a third party until that is
inlined. It opens on the reconciliation, lists every way in, follows
any one of them across service boundaries, and has a tab each for every crossing
and for everything that did not join.

It is a report you can click, not a viewer you keep running. A page generated
from a build can be attached to a review or kept beside a decision; a UI that
has to be alive to answer anything is the thing this project set out not to
build.

### Serving it to an agent

```sh
flowatlas mcp --install       # register in every repository of the project
flowatlas mcp                 # serve over stdio, which the editor does for you
```

`--install` writes `.mcp.json` into each repository, merging rather than
overwriting so any servers already there survive. After that, `claude mcp list`
shows `flowatlas`, and a session has ten tools:

| Tool | Answers |
|---|---|
| `list_entries` | every way in — routes, procedures, bot triggers, jobs, message handlers — filtered by service, kind or path |
| `get_flow` | one entry followed through every service it reaches |
| `who_calls` | what reaches a symbol, across repositories |
| `impact` | every entry point that can reach a symbol, and whose |
| `who_emits` / `who_consumes` | both ends of a message channel |
| `get_type` | the shape of a type, with what it refers to |
| `check_contract` | whether two services still agree about what crosses |
| `find_symbol` | fuzzy search, by substring or camel-case initials |
| `get_source` | the code of one symbol, and the only tool returning code |

Every tool takes `detail` and `maxNodes` except `get_source`, which takes
`context` and a line limit instead. Source leaves through `get_source` and
nowhere else, so asking for a trace never drags in the body of every method on
the path.

[**docs/mcp.md**](docs/mcp.md) is the whole thing: setup per client (Claude
Code, Cursor, VS Code, Claude Desktop), what each tool takes, the order to call
them in, and what to check when a client will not list the server.

---

## Configuration

`flowatlas.config.json` names the repositories and how they reach each other.
`flowatlas link` writes it; you edit it when the tool cannot work something out.

```jsonc
{
  "services": [
    {
      "name": "admin-api",
      "repo": "../admin-api",
      "type": "nestjs",
      // settings keys other services use to address this one
      "baseUrlEnv": ["ADMIN_API_URL", "ADMIN_API_BASE"]
    },
    { "name": "bot", "repo": "../bot", "type": "nestjs" },
    {
      "name": "web",
      "repo": "../web",
      "type": "angular",
      // which service a browser's settings key points at
      "apiTarget": { "apiUrl": "admin-api" }
    }
  ],

  // packages whose types are one declaration, not two copies
  "sharedPackages": ["@acme/contracts"],

  "adapters": {
    "auto": true,
    // a repository base of your own, and where its classes state their table
    "db": { "localBaseClasses": [{ "name": "BaseRepository", "tableProperty": "collectionName" }] },
    // a client class of your own the reader could not follow to a request
    "frontend": { "localClientClasses": ["ApiClient"] },
    "broker": {
      "custom": [
        {
          "name": "in-house-bus",
          "channelKind": "channel",
          "producers": [
            { "receiverType": ["EventBusService"], "method": "publish",
              "channelArg": 0, "payloadArg": 1, "kind": "event" }
          ],
          "consumers": []
        }
      ]
    }
  },

  "output": ".flowatlas",
  "types": { "maxDepth": 3 }
}
```

The two keys that matter most:

**`baseUrlEnv`** is what turns a request into an edge. A service declares the
settings keys other services use to address it; when a request is rooted at one
of them, it resolves to that service's route. Without it, a request is recorded
but joined to nothing.

**`sharedPackages`** is what stops one declaration looking like two. A type both
repositories import from a shared package is merged into one registry entry, so
comparing a contract compares the same thing rather than a copy against itself.

**`readTestDirectories`**, on a service, names directories called like tests
(`fixtures`, `e2e`, `test`, …) that hold code the application runs. Every other
such directory is left out and reported with a row, so you see what to name.

---

## How it works

Four steps, each independently inspectable.

**1. Read each repository.** A repository is parsed with its own TypeScript
program and walked by an extractor chosen by its kind. NestJS knows about
modules, injection, controllers, guards and interceptors; Angular knows about
components, templates, services and the router. Both produce the same shapes,
because the model knows nothing about either.

The kind picks the reader, not the frameworks. A repository may hold as many as
it likes — a Nest application with a worker declaring routes in front of it, a
bot library beside the container — and each is recognised by an adapter detected
from that repository's manifest and from the manifests of the workspace packages
it declares. A route declared by a worker is an entry point on the same terms as
one declared by a controller, and so is a procedure in a tRPC tree, a file under
a Next.js or Medusa router, and a message handler.

A repository whose dependencies are not installed is still read. The checker
resolves nothing outside it, but the source still says what it means: an import
names the package, `express()` makes an application, an annotation names a
client's type and a model class names its table. What is read that way is marked
`heuristic`, and the run says once, plainly, that the read was partial.

**2. Find the leaves.** A chain of calls ends somewhere: a database, a cache, an
outgoing request, a settings key, a message published. Which one it is comes from
*the type of the receiver*, never its name, which is why a variable called
`orderRepo` whose type is local proves nothing and one called `x` whose type
comes from a database package proves everything.

An address is followed back to where it was decided, not read where it is used.
It arrives as a constructor argument, sits in a property, is reshaped by a
`replace` and a ternary, and only then reaches a template. All of that is
followed. A request made inside a shared client is attributed to the callers,
because the client knows the base and only the caller knows the path.

**3. Join them.** A request rooted at a settings key resolves to the service that
declares it, then to the route that answers it. Matching is exact on normalised
segments: a literal fills a hole, a hole never fills a literal, and where two
routes both answer, the one that spells out a segment wins — and a catch-all,
which opens the whole of the rest of the address, loses to both. A genuine tie is
refused rather than guessed. An address is an address within one application,
so where one service holds two applications serving the same path, a request
written inside one of them reaches its own, and a request from outside names both
and chooses neither. A procedure call is joined by its dotted path, in the
caller's own service or one its configuration names, and nowhere else.
Publishers meet handlers on the channel between them. Where a service is found
but its route is not, that is recorded as drift, because it is drift.

**4. Answer questions.** The joined graph is written as JSON and as SQLite. Every
query, from the terminal or from an agent, reads the database and bounds its own
answer.

### What it tells you it cannot see

The point is precision, not coverage. Anything that cannot be resolved is
recorded with a reason and a location rather than guessed at or dropped:

| Reason | What it means |
|---|---|
| `target-route-not-found` | the service is known, the route is not: real drift |
| `unknown-base-url-env` | a settings key no service claims |
| `ambiguous-route` | two routes answer equally; registration order decides |
| `ambiguous-route-application` | two applications in one service serve it; deployment decides |
| `dynamic-http-url` | the address is built at run time and cannot be read |
| `route-handler-unread` | a way in was found and the code behind it was not |
| `route-mount-unread` | the route was read, the prefix it is mounted under was not |
| `db-layer-unread` | a class of the project's own looks like a data layer nobody named |
| `marker-route-not-found` | an annotation points at a route that is gone |

Those are a handful of about a hundred; the whole list, grouped by what each is
about, is in [the command reference](docs/CLI.md#the-reasons-a-row-can-carry).
`flowatlas doctor` groups them with what to do, `flowatlas stats` counts them
and `flowatlas dead` explains the routes nothing calls.

A reader that could read nothing says so as well. A file the parser gave up on
is a `file-not-parsed` row; a service a reader opened and put nothing in the
graph from is named by `build` and refused by `doctor`; a reading that placed
some routes and not the rest says how many. The one failure this tool is built
not to have is silence that reads as a clean result.

An edge is never drawn on a guess *silently*. Some are drawn on a guess and say
so: on the project measured above, 19,406 edges were read from the code and 397
were inferred and carry `confidence: "heuristic"`. An inference is a guess with
its reasoning attached, and the field is there so you can filter on it, not so
the word can be avoided. What cannot be inferred either is recorded as
unresolved with a file, a line and a reason.

### When reading is not enough

Some addresses genuinely cannot be read. Annotate the call and the graph believes
you, recording the edge with `confidence: "marker"` so it is clear which edges
were told rather than found:

```ts
import { CallsService } from '@flowatlas/markers';

@CallsService('admin-api', 'POST /orders')
async submit(order: Order) {
  return this.transport.send(this.route, order);
}
```

Every edge carries how much to trust it, strongest first: `static` was read from
the code, `marker` was asserted by an annotation in the code, `declared` was
asserted by a document about code that is not here, `heuristic` was inferred —
from a name, from what the source states where the types were not installed, or
from an assumption the edge names. A fifth word, `runtime`, is reserved for an
edge observed while the code runs, and nothing here produces it yet.

A join is no stronger than the weaker of its two ends. A request read in full
that reaches a route a document declared is `declared`; one that reaches a route
read off an application recognised only from its source is `heuristic`; and one
joined by taking a mount every committed environment file leaves empty as empty
is `heuristic` and carries the settings it assumed.

---

## Where it stands

Working, verified against the five-repository project measured above, and held
to a fixture for every shape below. Each fixture's README says what it exists to
prove, and the path is given so you can run it.

- **Routes declared by a decorator.** NestJS controllers, with modules,
  injection and the whole wrapping layer, and the address the framework prints
  at start-up: the global prefix and URI versioning, read wherever the
  repository sets them rather than only in the entry file
  (`fixtures/nest-addressing`); a decorator imported from a subpath of the
  package, or under an alias (`fixtures/nest-subpath-imports`).
- **Routes registered by a call.** Express, Fastify, Koa and Hono, with the
  routers each route is mounted through and the middleware in front of it
  (`fixtures/express-service`, `fixtures/fastify-service`,
  `fixtures/koa-service`, `fixtures/hono-worker`); an application declared by a
  chain (`fixtures/express-chained-app`); a list of paths
  (`fixtures/express-path-array`); a mount through a published helper
  (`fixtures/koa-mount-helper`); one mount over a registry of applications that
  plugins fill (`fixtures/koa-plugin-registry`); a named handler handed to a
  wrapper the repository wrote (`fixtures/express-wrapped-handler`); and an
  application recognised from what the source states when the framework's types
  are not installed, marked `heuristic` (`fixtures/express-not-installed`). A
  framework nobody here has heard of can be described in configuration, in the
  same schema the four shipped ones are written in (`fixtures/custom-http`).
- **Routes declared by where a file is.** A file-system router is four values —
  its root, which file names declare a route, the prefix in front and which
  segment spellings it honours — so Next.js (app router, pages router, API
  routes) and Medusa are rows of one reading (`fixtures/react-next`,
  `fixtures/medusa-fs-router`). A verb a helper built, aliased or re-exported is
  read as the handler it names (`fixtures/next-reexport`,
  `fixtures/next-hollow`), and a server action built by `next-safe-action` or
  `zsa` is a boundary with its callers (`fixtures/next-actions`).
- **Procedures.** A tRPC tree is read on the server as one way in per procedure,
  addressed by the dotted path its callers write, with the guards inherited
  through the procedure it was built from (`fixtures/trpc-router`), and the
  client's `trpc.orders.list.useQuery(…)` is a request joined to it
  (`fixtures/trpc-join`).
- **Applications.** Two applications in one service — a NestJS API and a worker,
  or a second Next.js application under `examples/` — serving the same path are
  two entries, and a request written inside one reaches its own
  (`fixtures/nest-two-applications`, `fixtures/next-nested-apps`,
  `fixtures/next-caller-application`).
- **Monorepos.** A service is an application together with the workspace
  packages it declares at run time — not a member's devDependencies — and each
  package is compiled with its own path aliases (`fixtures/next-monorepo`,
  `fixtures/nest-dev-sibling`, `fixtures/workspace-package-paths`). Detection
  reads the workspace, not the leaf manifest (`fixtures/workspace-leaf`), and a
  framework a service has only through a member is named on `build`'s
  `at arm's length` line (`fixtures/next-sibling-nest-types`). `init` proposes
  one service per application in a workspace.
- **Data layers** for TypeORM, Prisma, Drizzle, Mongoose, Sequelize (including
  models declared with decorators), Kysely, Knex, node-postgres and MongoDB, and
  a repository base named in the configuration (`fixtures/nest-typeorm`,
  `fixtures/nest-prisma`, `fixtures/nest-drizzle`, `fixtures/nest-mongoose`,
  `fixtures/nest-sequelize`, `fixtures/nest-sequelize-typescript`,
  `fixtures/nest-kysely`, `fixtures/nest-knex`, `fixtures/nest-pg`). Where the
  table is named in the call — `from(users)`, `knex('orders')`,
  `selectFrom('asset')`, `@Table({ tableName })` — it is read from there, and a
  table assembled at run time is reported rather than guessed at. A query in a
  module of exported functions is read like one in a class
  (`fixtures/fn-data-layer`). Without `node_modules` the data layer is read from
  what the source states, at `heuristic` (`fixtures/db-not-installed`). A
  workspace package that re-exports a library's client needs nothing
  (`fixtures/nest-prisma-wrapper`); one that wraps it in classes of its own is
  named in the rows it produces until you name it in the configuration
  (`fixtures/nest-workspace-wrapper`). A Prisma client that was never generated
  is followed through the import that binds it, and a model is mapped to its
  table by the schema's `@@map` (`fixtures/prisma-not-generated`). Knex reached
  through an ORM manager's `getKnex()` is read as knex
  (`fixtures/nest-mikro-orm-knex`), and so is the SQL handed to `knex.raw`
  (`fixtures/nest-knex-raw`). A MongoDB collection is read where the driver's
  chain names it, `db.collection('orders').find()`, and a repository base of
  your own reads the table each subclass states in a property you name
  (`fixtures/nest-mongo-tables`). Redis and cache-manager, outgoing requests and
  settings keys are leaves too.
- **Channels** for Kafka, RabbitMQ, BullMQ and Redis pub/sub — both clients, and
  every spelling of a subscribe verb, `pSubscribe` and `sSubscribe` among them
  (`fixtures/nest-kafka`, `fixtures/nest-rabbitmq`, `fixtures/nest-bullmq`,
  `fixtures/nest-redis-pubsub`, `fixtures/nest-redis-v4`). socket.io is read
  from both ends under the namespace each end is on, whether a gateway declares
  it or the server opens it with `io.of('/live')` (`fixtures/socket-channels`,
  `fixtures/socket-namespaces`). An in-house bus is described in configuration,
  with locators for a name written as an option or stated once on a class, and a
  payload path for a message inside an envelope (`fixtures/object-channels`,
  `fixtures/fn-broker`). A publish is read wherever it is written, and a channel
  template whose varying part is a closed set of strings is folded into the
  channels it reaches (`fixtures/folded-channels`). The reply to a
  request-reply message is compared with what the handler returns, the way an
  HTTP response is (`fixtures/multi-repo-contracts`).
- **Browsers.** Angular templates, services and the router, lazy routes
  included (`fixtures/angular-basic`, `fixtures/angular-lazy-routes`); React
  components and hooks; requests made through the platform's `fetch`, `axios`,
  a pass-through wrapper, a base whose resource a subclass decides, or a client
  class the project wrote itself, recognised by following its verbs to the
  network or named in the configuration (`fixtures/angular-client-wrapper`,
  `fixtures/react-local-client`, `fixtures/react-client-base`). A browser
  holding a stream open is a request like any other (`fixtures/sse-stream`).
- **Bots.** Telegraf, both the decorator style and the imperative one, and a
  table of handlers the project keeps itself (`fixtures/nest-telegraf`,
  `fixtures/bot-registry`).
- **Documents.** A service whose source you do not have is declared by an
  OpenAPI or AsyncAPI document, and joins and compares like any other end at
  `declared` confidence (`fixtures/multi-repo-declared`,
  `fixtures/multi-repo-asyncapi`).
- **Guards.** Everything in front of a way in is a node and an ordered
  `guarded_by` edge — NestJS guards, interceptors and pipes, call-registered
  middleware, a procedure's `.use(…)`, a file-system router's declarative list —
  and four checks report a route whose gate is missing, bypassed, a catch-all,
  or silently stripping a field (`fixtures/nest-guards`).
- **Comparing** what each side of a boundary declares, field by field, with the
  rules of the JSON wire applied so a date meeting a string is not a finding
  (`fixtures/multi-repo-contracts`).
- **Honesty about itself.** A graph nobody could report on — a failed build, an
  empty graph, a service that contributed nothing, a service whose ways in were
  mostly read no further than their addresses — makes `doctor` exit 2. A read
  without dependencies says so once. A file the parser gave up on, a
  description that matched nothing and a reading that placed only some routes
  are each a row rather than a smaller graph (`fixtures/unreadable-file`,
  `fixtures/next-hollow`).
- **Serving** the graph to an agent, to a terminal in three formats, and to a
  browser as one generated page; **rebuilding** only what changed, with a watch
  mode, and noticing when dependencies were installed since; **reporting** every
  finding as one list with a baseline; and **comparing revisions**, so a branch
  reports which entry points in which other repositories would notice it.

Known gaps in what it can read:

- A repository built on anything but the frameworks above. Nuxt, Remix, Vue and
  Svelte are recognised by name and read by nothing: `init` and `build` both say
  which repository and which framework, and the graph is smaller than the
  project by exactly that much.
- A file-system router nobody has described — `@fastify/autoload`, or a
  convention of the repository's own. The reader says it cannot tell such a
  repository from a library that merely depends on the framework, rather than
  calling it clean.
- Middleware installed in a different file from the routes it covers, because
  the order it runs in is the order modules are evaluated in, and nothing here
  reads that. A mount through a helper the repository wrote itself, whose prefix
  no description can place: the route is a row naming the call.
- A handler built at run time: a factory handed a function, a wrapper handed a
  list, a verb a package's helper assembles. The way in is found; the code
  behind it is a `route-handler-unread` or `route-handler-anonymous` row, and
  past half of a service's ways in `doctor` refuses the graph.
- In a Next.js repository, a layout, which decides what surrounds a screen
  rather than what crosses a boundary, and a `middleware.ts` whose matcher is a
  regular expression, which is reported rather than treated as coverage nobody
  checked. A server action built by a helper no description names is counted in
  one row.
- What a procedure's caller sends, compared with what the procedure takes. A
  real input is nearly always a validation schema whose type is the library's
  inference, so every procedure boundary is listed as unchecked with that reason
  rather than as agreeing.
- A socket read back out of a collection the program keeps itself. Which
  namespace it was opened on is somebody's bookkeeping, not a value the
  transport carries, so the publish stays on the root.
- A query written at the top level of a module, which runs when the module is
  imported and belongs to no function anybody can name. It is a
  `db-call-at-module-level` row rather than absent.
- A client whose type was erased. `(manager as any).getKnex()` may be an ORM's
  manager and may be anything with a method of that name, so the query is not
  read, and a `db-handover-unstated` row says which type to state.
- Test code. A file named as a test (`*.test.ts`, `*.spec.ts`,
  `*.integration-test.ts`) is not read, and neither is a directory named like
  one (`test`, `tests`, `e2e`, `fixtures`, `playwright`, `__tests__` and a few
  more). Each such directory is an `info` row with its file count, so a
  `fixtures` directory that holds runtime code is visible, and
  `readTestDirectories` reads it (`fixtures/nest-test-directories`).
- A data layer this repository declares and does not name. Where a query goes
  through a repository class of the project's own, the class is what says which
  table is meant, and `adapters.db.localBaseClasses` is where a reader names it,
  with `tableProperty` saying which property of each class states its table.
  Until it is named, those calls are rows saying so, naming the workspace package
  the class comes from where it comes from one, rather than queries nobody
  checked.
- An address built entirely at run time, where no part of it is written down,
  and a route whose address begins with a part read from a setting that some
  committed environment file sets, or that no committed environment file
  mentions. Each is reported rather than guessed at.
- Which of two applications serving one address a request from another service
  reaches. That is decided by deployment and written in no source, so both are
  named and neither is chosen.
- A helper whose tail depends on whether an argument is empty, where the caller
  passed something nobody can read. Both branches are real, so the path is
  reported as far as they agree and no further.
- A path accumulated into a reassignable variable across `if` statements is
  deliberately not followed, because reading the wrong branch would invent an
  edge.
- A channel whose name only exists as run-time data on both sides.

What it does on the five-repository project it was built against is
[measured at the top of this file](#measured-on-a-real-project). Every figure
there was read off a build rather than estimated, and the places it still cannot
read are listed above rather than rounded away.

---

## Working on it

```sh
pnpm check            # every gate, stopping at the first failure
```

Or one at a time:

```sh
pnpm -r build
pnpm -r typecheck
pnpm fixtures:run     # run the tool over every fixture
pnpm -r test          # 2,469 tests
pnpm invariants       # rules no test can express
pnpm fixtures:check   # extraction, server and terminal snapshots, and the read gate
```

`fixtures:check` compares against recorded output, so the fixtures have to be run
first, and a snapshot nobody compares is not a gate. It therefore prints two
counts — `161 compared, 162 validated` — and every snapshot in the gap between
them has to be accounted for: either the fixture has not been run, which fails and
says so, or the fixture is named in `VALIDATE_ONLY` in `scripts/fixtures-check.mjs`
with the reason, which the gate then prints on every run. One fixture is,
`schema-smoke`, because it is a hand-written sample of the schema and there is
nothing to run over it; an entry that no longer applies fails too. The other
direction is held as well: an output a fixture's run writes that no snapshot
holds is a failure, not a silence. A project fixture's snapshots are its graph,
its link report and its contracts report, and a fixture whose build is not yet
trusted as an expectation is named in `UNHELD` with the disagreement, printed on
every run the same way; that list is empty today. The last step is the read gate
from [the coverage harness](docs/coverage.md#the-read-gate), run over every
fixture's committed graph: a file with a route, a screen, a click or a query in
it must yield a node or a row naming the file. Whether a
fixture can be run at all, and with what, is `scripts/fixture-layout.mjs` and is
read from what the fixture declares — a `flowatlas.config.json` means a project
read by `build`, a `package.json` alone means one repository read by `extract` —
shared with `fixtures:run` so the two cannot disagree about it. `pnpm check` does
all of it in order, and passes from a clone with no build output at all.

Fixtures are small repositories under `fixtures/`, each committed with its type
stubs where a package had to be stood in for; the rest resolve through the
workspace, so a clone needs `pnpm install` and nothing more. Snapshots are produced by running the
tool and never written by hand; review the diff before accepting one.

**A stub may declare less than the library it stands for. It may never declare
something of a different kind.** A stub exists so the checker resolves an import
without an install, and every fact the tool reads off it — the package a type is
declared in, whether a call answers with a wrapper or with a value, whether a
name is exported at all — has to be the fact the real library would have given.
Drop the methods nobody calls, drop the overloads, drop the fields; do not turn
an intersection into a class, an `Observable` into a plain object, a `Query`
into a `Promise`, or a name the library never exported into one it did. The rule
is written in blood: a `drizzle` stub that returned a plain class where the
library returns an intersection let a defect that zeroed a real repository's
entire data layer leave every fixture green. Nor may a fixture source re-state
what a stub already says — a client method that hand-copies its own return type
is asserting the copy, not the library, which is how `{ data: unknown }` stood
in for `Observable<AxiosResponse<T>>` across ten repositories without anyone
noticing.

Three stubs are knowingly the wrong shape and are left that way, so nobody
audits them a second time from scratch: `axios`' default export is an object
where the real one is callable, `@angular/router`'s `RouterModule` is a const
object where the real one is a class with statics, and `pg`'s `PoolClient` is a
class where the real one is an interface. All three resolve to the same origin
either way, which is the only fact the tool reads off them.

Adding or removing a line in a fixture source is free, and deliberately so. A
node id still carries the line the node was read at — identity by place is what
lets two builds of the same source agree — but nothing asserts a coordinate any
more. `scripts/fixture-nodes.mjs` answers for the one node a description picks
out, given a node type and one relation:

```js
resolveNodeId(graph, {
  type: 'http_out',
  calledBy: 'gateway#src/clients/orders.client.ts:OrdersClient.fetchOne',
});
```

It answers with exactly one node or throws, naming the candidates when a
description fits more than one and saying what the symbol does reach when it
fits none; `packages/cli/src/fixture-nodes.test.ts` holds it to both. The
command-line tests, the server tests, `scripts/mcp-snapshots.mjs` and the
recorded demo scenes all go through it, the last of those via
`scripts/fixture-node-id.mjs`, so a scene types the real id without having one
written into it.

So a line added to a fixture source moves the recorded snapshots, which are
regenerated with `node scripts/fixtures-check.mjs --update`,
`pnpm mcp:snapshots -- --update` and `pnpm cli:snapshots -- --update`, and
moves no test. Coordinates still written out in the tests —
`packages/cli/src/{analysis/config-keys,doctor/hints,render/render}.test.ts`,
`packages/cli/src/test-graph.ts`, `packages/cli/src/fixture-nodes.test.ts` and
the two `packages/linker` tests — belong to graphs built in the test itself and
name no fixture, so they hold nothing in place.

Two fixtures state in their own README what their source ought to produce, and
are asserted fact by fact rather than compared against a recording:
`fixtures/ground-truth` in `packages/cli/src/commands/ground-truth.test.ts`,
there and over `multi-repo` and `nest-leaves`, and
`fixtures/multi-repo-contracts` in
`packages/cli/src/commands/contracts.test.ts`. A snapshot proves the answer has
not changed; only something written from the source proves it is right.

`docs/getting-started.md` is the walkthrough, recorded step by step, and
`scripts/demo/page.mjs` writes the same thing as `docs/index.html`, which is what
GitHub Pages serves at <https://panevschi-ruslan.github.io/flowatlas/>.
`docs/CLI.md` is the complete reference: every command, every flag, every
configuration key. `docs/mcp.md` is the graph server. `docs/ci.md` is how to run
it in a build. `docs/coverage.md` is how this tool is measured against
repositories nobody here wrote, by one counting rule; the list of repositories and
the reports stay on the machine that measures. The [fixtures page](https://panevschi-ruslan.github.io/flowatlas/fixtures.html)
lists every fixture and what it proves, generated from their READMEs.
`PUBLISHING.md` is the release runbook. `scripts/demo/record.sh` remakes every recording in the
walkthrough from `fixtures/multi-repo`.

### The rules the code is held to

Twelve invariants. `pnpm invariants` enforces three of them on every run — the
first, the eleventh and the twelfth — together with three gates of its own: no
file in the tree carries a raw control character, every reason a row carries is
a reason `doctor` knows, and the coverage harness and the tool agree about what a
service is. Each gate was watched failing before it was trusted.

1. The core names no technology. Anything that knows what TypeORM is lives
   behind an adapter.
2. Adapters are reached through a registry. No adapter is privileged.
3. Precision over recall. What can be read is read; what can only be inferred
   is marked `heuristic`; what is neither is recorded with a reason. No edge
   carries more certainty than it earned. Nothing enforces this but review.
4. Every edge carries a confidence.
5. Types are referenced by id, and nesting is capped.
6. One id format, and paths are normalised the same way on both sides.
7. Detail is a read-time concern. What is written to disk is always complete.
8. A bot entry is an ordinary entry. No branch treats it specially.
9. Output offered to an agent is bounded and says when it was cut.
10. Annotations only where reading is blind.
11. The schema is versioned; a model change bumps it, updates the parser and the
    tests, and regenerates every snapshot.
12. Extractors are siblings. None of them can be reached from another, through
    its dependencies or anything behind them; work two of them share lives in a
    package neither owns.

---

## Licence

MIT.
