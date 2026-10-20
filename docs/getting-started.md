# Getting started

From nothing to a graph you can walk, and the first four questions worth asking
of it.

Everything below can be run. The examples use the fixtures in this repository —
small projects under `fixtures/`, each with a README saying what it exists to
prove — so you can try every step before pointing the tool at your own code.
The main one is [`fixtures/multi-repo`](../fixtures/multi-repo): four services
that do not share a repository, a gateway, an orders service and a billing
service written with NestJS, and an Angular frontend. It is small enough to read
in a sitting, and it already has the problems a real project has: a call nobody
can address, a route one service asks for and another no longer serves, and two
repositories that disagree about a type.

The recordings on this page are of that fixture, and the same walkthrough is a
site at <https://panevschi-ruslan.github.io/flowatlas/>. Every recording can be
made again with `scripts/demo/record.sh`.

---

## 1. Install

Node 22.12 or newer, and the repositories of one project checked out beside each
other. That is the whole list.

```sh
npm install -g @flowatlas/cli
```

Or run it without installing anything:

```sh
npx @flowatlas/cli build
```

To run the examples on this page, use a checkout of this repository instead,
because the fixtures are in it:

```sh
git clone https://github.com/Panevschi-Ruslan/flowatlas.git
cd flowatlas
pnpm install
pnpm -r build
pnpm flowatlas --help          # the same command as `flowatlas`
```

Nothing is executed from the repositories being read. flowatlas parses them with
the TypeScript checker and closes the files.

**Install each repository's dependencies if you can.** The checker follows a
type into a package only when the package is on disk. A repository read without
them is still read — the source says a great deal on its own, and what is read
that way is marked `heuristic` — but a run over one opens with a sentence saying
the read was partial, and means it.

---

## 2. Point it at the repositories: `init`

Put yourself in a directory with the repositories under it, or beside them, and
run `init`. It reads each manifest, works out a name and a type for each
repository, and writes `flowatlas.config.json`. It also registers the graph
server in every repository, so an agent working in any one of them can ask about
all of them.

```sh
flowatlas init            # look beside the directory you are in
flowatlas init --dir .    # look under this directory instead
```

> `init` with no `--dir` scans the *parent* directory, which is what you want
> when the configuration lives inside one of the repositories. Pass `--dir .`
> when it lives above them. It looks one level down, at each directory with a
> `package.json`.

Over a copy of `fixtures/multi-repo`, with its configuration deleted, it
proposes this:

```
$ flowatlas init --dir . --yes
Wrote …/flowatlas.config.json with 4 service(s):
  billing  ./billing  nestjs
  gateway  ./gateway  nestjs
  orders  ./orders  nestjs
  web  ./web  angular
```

Without `--yes` it asks about each one. The type is what decides which reader
opens a repository, and it is read from the manifest: a server type wins over a
browser type when a repository declares both, because the server reader reads
the browser half too. A framework nothing here reads — Nuxt, Vue, plain
Svelte — is named rather than silently skipped; SvelteKit and Remix are read
for their file routes, loads and actions.

**A monorepo is proposed as its applications.** A repository that declares a
workspace, in `workspaces` or a `pnpm-workspace.yaml`, becomes one service per
member that looks like an application, and none for the packages those
applications import, because a package is read as part of whichever service
declares it. Run from the directory holding a copy of
[`fixtures/next-monorepo`](../fixtures/next-monorepo), whose Next.js application
is in `apps/web` and whose handler bodies are in `packages/orders-lib`:

```
Wrote …/flowatlas.config.json with 1 service(s):
  web  ./next-monorepo/apps/web  nextjs
```

Point `init` at the directory the monorepo sits in, not at its root: it looks one
level down, and from inside a root whose members are two levels down, as
`apps/web` is, it finds nothing.

One service, and one graph that runs from its route into the package:

```
◆  GET /api/orders              web/app/api/orders/route.ts:7
  →  GET                        web/app/api/orders/route.ts:7
    →  listOrders               web/../../packages/orders-lib/src/index.ts:11
      →  readOrders             web/../../packages/orders-lib/src/store.ts:13
        ⚙  ORDERS_UPSTREAM_URL  web/../../packages/orders-lib/src/store.ts:14
        ↗  GET /orders          web/../../packages/orders-lib/src/store.ts:16
        ↗  GET /orders          web/../../packages/orders-lib/src/store.ts:16
unresolved on this path: 2
```

The request is there twice because one `fetch` is read by both halves of a
repository that is a server and a browser at once, and the two rows are true: the
far side is not in this configuration, and nothing declares
`ORDERS_UPSTREAM_URL`.

`flowatlas link ../gateway ../orders ../web` is the same thing with the
repositories named rather than discovered, for when they are not all in one
place. Adding one later is one more `link`.

## 3. Read and join them: `build`

`build` reads every repository in its own process and joins the readings: a
request made in one service to the route that answers it in another, a message
published in one to whatever handles it, a button in a browser to the endpoint
it calls.

```sh
pnpm flowatlas build --config fixtures/multi-repo/flowatlas.config.json
```

![flowatlas init and flowatlas build](media/01-init.gif)

The summary is the part to read (each service's line also says how long it
took, left out here):

```
built 130 nodes, 114 edges from 4 service(s)
  billing        23 nodes, 0 unresolved
  gateway        43 nodes, 1 unresolved
  orders         33 nodes, 0 unresolved
  web            32 nodes, 3 unresolved
calls out: 7 total, 3 linked, 1 by annotation, 1 no route, 1 unknown setting, 0 ambiguous, 1 third party, 1 dynamic
ui calls: 13 total, 6 joined to a route, 7 not (ambiguous-route-target 1, api-path-dynamic 3, api-path-partly-read 1, target-route-not-found 2)
channels: 3 total, 1 joined, 1 with no handler, 1 with no publisher
routes: 15 total, 7 reached, 8 never called, 1 claimed by two handlers
ways in: 17 found, 17 with a handler that was read, 0 without — only the second number is coverage of what happens after the request arrives
types: 15 (4 from shared packages)
missed: 9 · notes: 0 · findings: 4
```

A first build is rarely all joined, and it is not supposed to be. Nothing was
guessed: every request that did not join is counted by the reason it did not.
Four lines are worth knowing about before they surprise you:

- **`ways in`** counts entry points found apart from entry points whose handler
  was read. Only the second is coverage of what happens after a request arrives.
- **`… contributed no node`** names a service a reader opened and put nothing into
  the graph from, usually because its `type` names a reader for a framework it
  does not use.
- **`… found at arm's length`** names a framework a service has only through a
  workspace package it declares, so you can judge whether that package's code
  really runs there.
- **`missed · notes · findings`** counts the rows apart: what the reader could
  not follow, how a join was made where nothing was missed (a base address taken
  from an example environment file), and what the code itself does that a
  reviewer would want to see (a likely N+1, a route with no guard).

`build` writes three files under `.flowatlas`: `project-graph.json`, the graph
itself; `link-report.json`, what joined and why not; and `graph.db`, the same
graph as SQLite, which every question below reads. What it keeps between builds
is there too, in `cache.json`, `stand-ins.json` and under `services/`; it writes nothing into the repositories it
reads. A second build of unchanged
sources reads nothing again, and `build --watch` keeps the project open and
rebuilds on every save.

## 4. Ask what it could not read: `doctor`

`doctor` turns those counts into a list of things to do, grouped by reason, with
the file, the line and what to change.

```sh
pnpm flowatlas doctor --config fixtures/multi-repo/flowatlas.config.json
```

![flowatlas doctor](media/02-doctor.gif)

The first line is the verdict:

```
unresolved: total=11 (missing) · markers: errors=0 warnings=0 · desync=5 · contracts: errors=0 ignored=0 · rules: errors=0 new=0 · exit=0
```

`total=11` is the rows somebody could act on. The places static reading cannot
see at all are counted beside them and never added in, and neither are the
places where nothing joins because there is nothing to join. `(missing)` says
there is no baseline yet; `flowatlas doctor --accept` writes one, to commit like
a lockfile, and from then on `--strict` fails only on growth.

`doctor` has a section per kind of finding, and each can be asked for on its own:

```sh
flowatlas doctor --section unresolved    # what could not be read, grouped by reason
flowatlas doctor --section desync        # calls that no longer match a route
flowatlas doctor --section markers       # annotations that point at something gone
flowatlas doctor --section contracts     # what two services disagree about
flowatlas doctor --strict                # exit 1 if any of it is a problem
flowatlas doctor --reason <code>         # every place of one kind of gap
flowatlas doctor --missing               # the repository probably missing, and why
```

On a first build of the demo, `doctor` names `payments` as a repository that is
probably missing - the one setting, `PAYMENTS_URL`, that no service claims - and
asks for the two settings the next step adds.

**Exit 2 means the graph is not one to report on.** Four graphs are refused
whatever flags were given: one a failed build wrote, one with no node in it, one
a service contributed nothing to, and one where most of a service's ways in were
read as far as their addresses and no further. In each of those every check would
answer "nothing wrong" about code nobody read.
[`fixtures/next-hollow`](../fixtures/next-hollow) is both of the last two at once:

```sh
pnpm flowatlas build  --config fixtures/next-hollow/flowatlas.config.json
pnpm flowatlas doctor --config fixtures/next-hollow/flowatlas.config.json --no-baseline
# unresolved: total=6 (skipped) · … · exit=2
```

## 5. Answer it in the configuration

Most of what a first build cannot join is a fact only the person who deployed
the project knows. Two settings do most of the work.

**`baseUrlEnv`** says which settings keys other services use to address a
service. Without it, a key named after a service (`ORDERS_URL`, `orders`) is
still joined to it, with a `base-url-from-name` note saying only the name chose
it, and a key named after nothing (`PAYMENTS_URL`) is joined to nothing.

**`apiTarget`** does the same for a browser: it says which service a frontend's
settings key points at.

![editing the configuration and building again](media/03-configure.gif)

What survives a configured build is no longer missing configuration. It is the
project disagreeing with itself, which is the thing worth knowing.

## 6. The first four questions

### Follow one request: `flow`

`flow` takes any way in and follows it until it stops.

```sh
pnpm flowatlas flow "POST /orders" --config fixtures/multi-repo/flowatlas.config.json
```

```
◆  POST /orders                                        orders/src/orders/orders.controller.ts:31
  →  OrdersController.create                           orders/src/orders/orders.controller.ts:31
    →  OrdersService.create                            orders/src/orders/orders.service.ts:40
      ▣  write orders                                  orders/src/orders/orders.service.ts:41
        ▤  orders
      ⚡ event order.created                            orders/src/orders/orders.service.ts:49
        ⚡ order.created                                src/orders/orders.service.ts:49
          ⇢ billing ⚡ InvoicesConsumer.onOrderCreated  billing/src/invoices/invoices.consumer.ts:17
            →  InvoicesConsumer.onOrderCreated         billing/src/invoices/invoices.consumer.ts:17
              →  InvoicesService.create                billing/src/invoices/invoices.service.ts:30
                ⚙  ORDERS_URL                          billing/src/invoices/invoices.service.ts:33
                ↗  GET /orders/:param                  billing/src/invoices/invoices.service.ts:33
… truncated: ≥1 more nodes (raise --depth)
unresolved on this path: 0
```

One route, the row it writes, the event it publishes, and the handler in another
repository that receives it, marked `⇢ billing` where the walk crosses into it -
which reads `ORDERS_URL` and calls back into orders for the order it was told
about. The walk stops at the default depth and says so; `--depth 20` follows it
into orders again.
`unresolved on this path: 0` says nothing along it was guessed. `--ascii` prints
plain prefixes instead of the icons.

![flowatlas flow](media/04-flow.gif)

An entry can be named however you would say it aloud. These three are the same
route:

```sh
flowatlas flow "POST /orders/12345/archive"
flowatlas flow "POST /orders/:param/archive"
flowatlas flow "entry:orders:http:POST:/orders/:param/archive"
```

A tRPC procedure is named by its id, `entry:api:rpc:orders.list`, and a name that
matches two applications or two services comes back as a choice rather than a
guess. `flowatlas config <entry>` lists every setting a flow depends on, across
every service it touches, which is the answer to "what do I have to set for this
to work at all".

### Ask the other direction: `impact`

`impact` starts at a symbol and walks backwards to every way in that reaches it:
the answer to "what would have to be retested".

```sh
pnpm flowatlas impact OrdersService.create --entries-only --config fixtures/multi-repo/flowatlas.config.json
```

```
→  OrdersService.create  orders/src/orders/orders.service.ts:40
  ◆  POST /orders        orders/src/orders/orders.controller.ts:31
Reachable from: 1 http entry (orders)
```

Give it a table and it names the routes that write it. Give it a method and it
names the ones in other people's services.

![flowatlas impact, hotspots and channel](media/05-impact.gif)

### Look for what nothing reaches: `dead`

```sh
pnpm flowatlas dead --kind entries --config fixtures/multi-repo/flowatlas.config.json
```

```
nothing here is proof: every row is a heuristic with the reason it fired
…
entries:
  id                                       where                                   verdict  why
  entry:billing:event:invoice.requested    src/invoices/invoices.consumer.ts:28    dead     channel:invoice.requested has no publisher in any repo
  entry:billing:http:GET:/invoices/:param  src/invoices/invoices.controller.ts:26  dead     no http_calls/hits from any repo (may be a public API)
  …
```

It says so itself: nothing in it is proof. Every row carries the reason it is
there, and a route that is public by decision, a health probe or an event stream
says which, so the rows nothing explains come first.

### See both ends of a message: `channel`

```sh
pnpm flowatlas channel order.created --config fixtures/multi-repo/flowatlas.config.json
```

```
⚡ order.created                             src/orders/orders.service.ts:49
  ·  producers (1)
    ⚡ event order.created                   orders/src/orders/orders.service.ts:49
  ·  consumers (1)
    ⚡ InvoicesConsumer.onOrderCreated       billing/src/invoices/invoices.consumer.ts:17
      →  InvoicesConsumer.onOrderCreated    billing/src/invoices/invoices.consumer.ts:17
        →  InvoicesService.create           billing/src/invoices/invoices.service.ts:30
          ⚙  ORDERS_URL                     billing/src/invoices/invoices.service.ts:33
          ↗  GET /orders/:param             billing/src/invoices/invoices.service.ts:33
            ⇢ orders ◆  GET /orders/:param  orders/src/orders/orders.controller.ts:25
              →  OrdersController.findOne   orders/src/orders/orders.controller.ts:25
                →  OrdersService.findOne    orders/src/orders/orders.service.ts:25
                  ▣  read orders            orders/src/orders/orders.service.ts:26
… truncated: 1 more nodes (raise --depth)
```

A channel with nothing at one end comes back with an empty list, which is an
answer rather than an error.

---

## 7. Try it on the other shapes

Each of these is one command from a checkout, and each fixture's README says what
to look for.

| Fixture | What it shows |
|---|---|
| [`trpc-join`](../fixtures/trpc-join) | procedures on the server, and `trpc.orders.list.useQuery(…)` in a browser joined to them by path |
| [`next-caller-application`](../fixtures/next-caller-application) | one service holding three Next.js applications, and a request reaching its own application's route |
| [`nest-two-applications`](../fixtures/nest-two-applications) | an API and a worker in one repository, each serving `GET /health` |
| [`socket-namespaces`](../fixtures/socket-namespaces) | socket.io read from both ends, with the namespace opened by `io.of(…)` |
| [`object-channels`](../fixtures/object-channels) | an in-house job bus described in configuration alone |
| [`multi-repo-asyncapi`](../fixtures/multi-repo-asyncapi) | a service you do not have the source of, declared by an AsyncAPI document |
| [`nest-mount-empty`](../fixtures/nest-mount-empty) | a route behind a mount every environment file leaves empty, joined and marked as a guess |
| [`express-not-installed`](../fixtures/express-not-installed) | an Express service with no `node_modules`, read from what its source states |
| [`koa-react-full-stack`](../fixtures/koa-react-full-stack) | one directory that is a server and a browser, read by the reader that reads both |

A fixture with a `flowatlas.config.json` is a project:

```sh
pnpm flowatlas build --config fixtures/trpc-join/flowatlas.config.json
```

and one with only a `package.json` is a single repository, read without joining:

```sh
pnpm flowatlas extract fixtures/express-not-installed --out /tmp/express-not-installed
```

---

## 8. Compare what crosses a boundary

Two services agree about a shape until one of them changes. `contracts` compares
what each side of every crossing declares, field by field.

![flowatlas contracts and types --drift](media/06-contracts.gif)

The `unchecked` list matters as much as the findings. It says which boundaries
could not be compared and why, rather than reporting them as agreement.
`types --drift` is the cheaper question: which names are declared two ways in two
repositories.

## 9. See the shape of the whole thing

![flowatlas stats, dead and cycles](media/07-explore.gif)

```sh
flowatlas stats --format tree   # what the graph is made of
flowatlas cycles                # circular dependencies, cross-service first
flowatlas hotspots              # what the most things point at
flowatlas visualise             # the whole graph as one self-contained page
```

`visualise` writes one page with the graph inside it: no server and nothing to
install. It asks Google Fonts for two typefaces and falls back to yours if it
cannot reach them, so it reads offline but is not yet free of a third party. It
opens on a *Map* of the services, queues, tables and outside hosts in the order a
request travels, with *Start here* offering the busiest way in and the worst gap.
*Steps* shows one way in as a list in call order, with what it can fail with, a
*Waterfall* of its typical times once traces are laid over it, and a *Copy as
prompt* button; *Not joined* groups what could not be followed by cause, beside
the risks found in the code and what was accepted; *Busiest* ranks the methods
most things lean on; *Crossings* lists every join between repositories;
*Traces* draws real requests one at a time; *Graph* draws the neighbourhood of
any node, every type on hover. `flowatlas visualise --diff main` adds a
*Changes* tab for a branch, and `--observed-diff before.json after.json` a *Run
time changes* tab for a deploy. One search box, reached with `/`, finds a route,
channel, table, type, gap or class and goes to it; `?` lists the keys and ⌘K the
commands.

![the generated page](media/10-visualise.png)

![a tour of the page](media/14-map-tour.gif)

## 10. Ask what a branch changes

`diff` builds the graph at two revisions and reports what moved between them.

![flowatlas diff](media/08-diff.gif)

One route is renamed in the orders service, and flowatlas names every way in that
reached it - the gateway route, billing's handlers and the browser button above
them, in repositories the change does not touch - and shows each flow it cuts,
step by step, as a sequence diagram in the Markdown. The output is Markdown
because its destination is a pull request comment; `--fail-on-contract-break`
and `--fail-on-rule-break` make it a build failure instead. `flowatlas check
--env production` asks the same question against what an environment runs. See
[docs/ci.md](ci.md) for the whole recipe.

## 11. Lay what really ran over it: `observe`

Everything so far was read from code. `observe` adds what real traffic did, from
OpenTelemetry, Zipkin, Jaeger, @nestjs/observe, the HAR files a Playwright run
saves, or AWS exports, and lays it over the map: how often each join ran, how
long it took, how it answered. A trace never draws an edge; what it shows that
the code does not is listed as a question.

```sh
t=fixtures/multi-repo/traces
pnpm flowatlas observe $t/checkout.otlp.json $t/orders.observe.json $t/billing.observe.json \
  --config fixtures/multi-repo/flowatlas.config.json
pnpm flowatlas doctor --reason failure-seen-undeclared --config fixtures/multi-repo/flowatlas.config.json
```

![flowatlas observe](media/15-run-time.gif)

One route answered 500 that nothing in its code declares; doctor names it, and
the page puts the same counts and timings on every step. [Run time in five
minutes](run-time.md) goes from an end-to-end test run to that picture.

## 12. Give it to an agent

`init` already registered the server in each repository. An agent in any one of
them gets the whole project.

![flowatlas mcp](media/09-mcp.gif)

Twenty-six tools, and only one of them returns source code. A trace never drags in the
body of every method along it; the agent asks the graph which name to look at,
then asks for that one name. A session is offered only the tools your project can
answer - nineteen on the demo - and the run-time ones appear once you have run
`flowatlas observe`, without a restart; `flowatlas mcp --all-tools` lists every
one.

```sh
flowatlas mcp --install       # register in every repository, merging what is there
flowatlas mcp --install --dry-run
```

After that, `claude mcp list` shows `flowatlas`.

---

## Where to go next

- [Through a change, start to finish](workflow.md) — which command to reach for
  before a change, while coding, before the PR, in CI, at deploy and after it runs.
- [The graph server](mcp.md) — setup for Claude Code, Cursor, VS Code and Claude
  Desktop, what each of the twenty-six tools takes, and the order to call them in.
- [The command reference](CLI.md) — every command, every flag, every
  configuration key, and every reason a row can carry.
- [Running it in CI](ci.md) — the staged adoption that does not fail the build on
  day one.
- [Run time in five minutes](run-time.md) — from an end-to-end test run to counts
  and timings on the map.
- [Coverage](coverage.md) — how the tool is measured against repositories nobody
  here wrote.
- [The README](../README.md) — how the joining works, what it reads, and what it
  still cannot.

## Reproducing these recordings

```sh
scripts/demo/record.sh          # every terminal scene, into docs/media
scripts/demo/record.sh 04 09    # just those two
node scripts/demo/page-tour.mjs "$(scripts/demo/page-project.sh)"   # the page's still and tour
```

Most scenes run against `fixtures/multi-repo`; the stream one runs against
`fixtures/sse-stream`, and the folded-channel one against
`fixtures/folded-channels`.

Each scene is a shell script under `scripts/demo/scenes`. The commands you see
typed are the commands that ran; the driver sizes the terminal to the scene and
renders it with [asciinema](https://asciinema.org) and
[agg](https://github.com/asciinema/agg).

```sh
brew install asciinema agg jq ffmpeg
```

The page's pictures are taken in a headless Google Chrome, driven over its
DevTools protocol (`CHROME` names another browser); `DEMO_DRY=1
scripts/demo/record.sh` runs the scenes untyped and keeps what each printed in
`.demo-casts`, to read before recording.
