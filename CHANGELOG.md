# Changelog

All notable changes to the published packages. `@flowatlas/cli` and
`@flowatlas/markers` are versioned separately; an entry names the package when
only one of them moved.

## [Unreleased][unreleased]

### Added

- **Lambda functions and API Gateway routes, read from Terraform.** A service of
  type `lambda` is a repository of handlers whose ways in are declared in
  Terraform rather than in code. Every `aws_lambda_function` is an entry of a
  new kind, `invoke`, under the name it is deployed with, and lands on the
  exported handler its `handler` string names — through a middleware chain such
  as `middy(fn).use(...)`, and through a handler packaged from `dist/`, mapped
  back to its source by the tsconfig. Every REST API method and HTTP API route
  is an ordinary `http` entry onto the same handler, with its authoriser as a
  guard. `init` and `link` propose the type from the manifest, from a manifest
  per function directory, or from the Terraform alone, so a repository of
  nothing but Terraform is a service. `fixtures/lambda-terraform-rest`.
- **A shared API, joined across repositories.** A route that hangs from a point
  of an API another repository publishes — through a parameter or another
  state's output — gets its full path from that repository at link time, and a
  route integrated with a function another repository deploys gets that
  function's handler, joined on the name. `fixtures/multi-repo-lambda`.
- **Terraform modules.** A local module is read with its inputs bound. A module
  from a registry or another repository is described under
  `adapters.infra.modules`, in the module's own language;
  `terraform-aws-modules/lambda/aws` and `terraform-aws-modules/apigateway-v2/aws`
  ship described. A remote module nothing describes is one `doctor` row naming
  it and the inputs it was given. `fixtures/lambda-terraform-modules`.
- **`services[].infra.vars`** chooses the variable files a deployment is read
  with. Without it, a name two `*.tfvars` files set differently is a row naming
  the variable and the files, never a name picked from one of them.
- **`flow invoke:<name>`** starts from a function by its deployed name.
- **A state machine is a way in, and its states are steps.** A definition in
  the Amazon States Language that a repository keeps as a file of its own -
  `*.asl.json`, `*.asl.yaml` - is read in every service a server reader reads,
  with nothing to configure, and drawn as an entry of the new kind `workflow`
  that handles its first state. Every state is a `function` node of kind
  `state`, and every way control moves between two states - `Next`, each
  `Choice` rule and its `Default`, each `Catch`, every `Parallel` branch, a
  `Map`'s processor - is an edge saying which it is. `Retry`, and what a state
  is given and passes on, are kept on the node as written; nothing is
  evaluated. `flow workflow:loan-approval` walks it.
- **A step that starts another workflow is joined to it by name**, across
  services, the way a channel is. A step that reads or writes a table is a query
  on that table; a step that sends to a queue, a topic or a bus says which, on
  its step; any other integration is a step naming its service and action.
- **A name the definition does not state is a row, never a guess**: one chosen
  at run time by a path, an intrinsic or a JSONata expression
  (`workflow-target-dynamic`, nothing to fix), a `${...}` placeholder nothing
  here fills (`workflow-template-unbound`), a field that names nothing
  (`workflow-target-unreadable`). A definition read on its own is named after
  its file and says so (`workflow-named-by-file`), and a join on that name is
  `heuristic`. A task that invokes a function joins to that function's `invoke`
  entry by its deployed name, in whichever service deploys it, and is a
  `reference-not-found` row where no service does
  (`fixtures/stepfunctions-asl-files`).
- **`flow workflow:<name>`** walks a state machine's steps in order and into
  each handler.
- **Publishing through the AWS SDK.** EventBridge `PutEvents`, SQS
  `SendMessage` and `SendMessageBatch`, and SNS `Publish` and `PublishBatch` are
  read as producers, whether the call sends a command (`client.send(new
  PutEventsCommand(input))`, built in the call or in a `const` before it), uses
  version 3's aggregated client, or uses version 2 with `.promise()`. Each entry
  of a `PutEvents` is an event of its own, on
  `eventbridge/<bus>/<source>/<detail type>`, and an entry that names no bus is
  on `default`. Queues and topics are `sqs/<name>` and `sns/<name>`, by the name
  inside the URL or ARN the code holds. The message is `Detail`, `MessageBody`
  or `Message`, read past `JSON.stringify`. The client's package may be declared
  in any manifest of the repository, for one that keeps a manifest per function
  (`fixtures/aws-sdk-publishers`). With nothing installed, a client is
  recognised by its construction and its import, at `heuristic`
  (`fixtures/aws-sdk-not-installed`). Who receives is declared in the
  deployment and is not read yet, so these channels have publishers and no
  handlers for now.
- **A name read from `process.env` is said to be one.** A channel named by an
  environment variable is a publisher with no channel and a new row,
  `channel-from-environment`, naming the variable, rather than a name the tool
  could not read. A queue's URL is usually written this way, and its value is
  set by the deployment.
- **Two locators and an address in parts, for describing a bus in
  configuration.** `argument-path` reads a path of properties inside an
  argument and `constructed-argument-path` reads one inside what a class is
  constructed with; `*` in a path is every element of a list, one channel each.
  A producer may give `address`, a list of parts joined with `/` - stated words,
  located names, a default for a part nothing writes, and the longer spellings
  a name may be written inside - and `payload`, where its message is written,
  and may be a `function` of the project's own rather than a method on a
  receiver. The AWS SDK is read through exactly these, so a project's own
  helper around it, a class or a function, is described the same way.

### Changed

- **The graph's schema version is 6**, for the `invoke` and `workflow` entry
  kinds. A database built by an earlier version is refused with a message to
  rebuild.
- **A `.tf` or `.tfvars` change re-reads the service.** The build cache stamps
  the files that describe a deployment beside the sources, so changing a
  function's name in Terraform alone is no longer answered with `0 files
  changed`.

### Fixed

- **A property of a parameter is no longer reported as a constant nobody could
  read.** `event.detail.type` read off a parameter is decided by each caller,
  and its row now says the channel is built at run time, as the parameter's own
  row does.

- **`build` no longer writes into the repositories it reads.** Each service's
  own graph and file hashes went to `<repo>/.flowatlas/`, which the
  documentation never said: it named three files in the output directory. Pointed
  at somebody else's checkouts for a read-only look, a build left an untracked
  `.flowatlas/` in every one of them, and two projects whose configurations name
  the same repository shared one set of those files and overwrote each other's,
  so each made the other's next build read everything again. Both now live under
  the configured output, at `<output>/services/<name>/`, and follow `--out`. A
  service name is written as one directory whatever it holds — `@shop/orders` is
  `%40shop%2Forders` — and two names never share one, even on a disk that ignores
  case. `flowatlas extract` on its own is unchanged and still writes where
  `--out` says.
- **The `.flowatlas/` an earlier version left in a repository is named, not
  deleted.** `build` says once which of them nothing reads any more and that they
  are safe to delete; `--json` carries the same sentence in `notes`. An output
  directory configured inside a repository is not one of them.
- **A watch no longer rebuilds for ever when its output is inside a repository
  it reads.** The output was left alone because its default name starts with a
  dot. Named anything else, every build's own writes came back as a change; it is
  now left alone by where it is.
- **The build cache is version 3.** The first build after upgrading reads every
  repository once, says `cache-invalid:version`, and is incremental from the
  next.
- **A handler wrapped with the function second lands on the function.** A
  tracing, retry or metrics helper that takes a name or options first —
  `traced('createLoan', createLoan)`, `withRetry({ attempts: 3 }, fn)` — or the
  function first and options after, left a Lambda function with an entry and no
  body, and an Express, Fastify, Koa or Hono route with none either. A call
  handed exactly one function is now a wrapper of it wherever it sits, inline,
  through a `const`, and inside a middleware chain (`middy(traced('x', fn))`).
  The edge is `static` where the wrapper's source or its package's declarations
  were read, and `heuristic` with the reason in `wrapperUnread` where its package
  is not installed. A call handed two functions is still a row naming the call.
  `fixtures/lambda-wrapped-handlers`, `fixtures/express-traced-handlers`.

## [0.5.1][] - 2026-09-28

`@flowatlas/cli` only: the npm page (README and keywords) brought up to date
with what 0.5.0 reads, and no change to the tool.

## [0.5.0][] - 2026-09-28

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0. The graph's
schema version moved, so a database built by 0.4 is refused with a message to
rebuild: run `flowatlas build` once after upgrading.

The tool read NestJS and Angular deeply and almost nothing else. It now reads
the shapes most TypeScript is actually written in — a route registered by a
call, a route that is the path of a file, a procedure in a tree, a component
that is a function, a query outside a class, a monorepo whose handlers live in
its packages, a repository nobody has installed, a service whose source you do
not have — and it says so about each one it cannot read rather than producing a
graph that is smaller than the project without mentioning it.

Every shape below is held by a fixture under `fixtures/`, named beside it, whose
README says what it exists to prove.

### Added

- **Express, Fastify and Koa**, where a route is registered by a call rather
  than declared by a decorator. One reader over all four call-registered
  frameworks, parameterised by a description of each; Hono became the first row
  of that table rather than the only implementation. The routers a route is
  mounted through and the middleware in front of it — including middleware
  installed on an application above the mount and inherited through it — are
  read, which is what lets the route audit answer on these repositories rather
  than defer to a person (`express-service`, `fastify-service`, `koa-service`).
- **The shapes a registration is really written in.** An application declared by
  a chain, `express().disable('x-powered-by')`, is that application
  (`express-chained-app`). A list of paths is one way in per path, written in
  place or named elsewhere (`express-path-array`). A mount through a published
  helper — `app.use(mount('/api', api))` from `koa-mount` — places the routes
  under its prefix, with the helper described once by the package it is imported
  from; a helper the repository wrote itself is a row naming the call the path is
  inside (`koa-mount-helper`). One mount over a collection of applications that
  plugins add themselves to is followed back to the calls that fill the
  collection, and a collection a package publishes is one row naming it
  (`koa-plugin-registry`). A named handler handed to a wrapper the repository
  declares, `asyncMiddleware(getVideo)`, is `getVideo`, and a factory called with
  values is read as having built the handler; a factory handed a function keeps
  no handler, because it cannot be told from one more wrapper
  (`express-wrapped-handler`).
- **An application recognised from what the source states.** In a repository
  whose framework is not installed the application's type resolves to nothing,
  and a reader that knows an application by its type read no route at all.
  `import express from 'express'` and `const app = express()` say what `app` is
  with or without types, so that is read where the checker commits to nothing —
  a call or `new` of a described export, an annotation, a class extending one, a
  function returning one — for all four call-registered frameworks from one
  description. Every route read off such an application carries `heuristic`
  confidence (`express-not-installed`).
- **A file-system router is four values.** The root directory, which file names
  declare a route, the prefix in front, and which segment spellings the router
  honours: that is all that differs between one and another, so the walk, the
  verb reading and the rows for a verb with nothing behind it are shared, and
  each router is a row of data. Next.js is three rows and Medusa is a fourth,
  with its declarative middleware list read and a matcher written as a regular
  expression reported rather than guessed (`medusa-fs-router`). A file under a
  directory the router does not serve is an `info` row, `route-file-not-served`,
  rather than silence. A file-system router nobody has described is still a row
  saying the reader cannot tell it from a library (`express-fs-router`).
- **React and Next.js.** A request is found wherever it is written and walked
  back to the component or hook that decided the address. A Next.js route is a
  directory path and a file name, with no call and no decorator registering it;
  a server action is a boundary with no address at all, crossed by an import,
  and one built by `next-safe-action` or `zsa` is read as the function it was
  handed (`react-next`, `next-actions`). A repository that is a browser and a
  server at once is read once, by the reader that reads both halves, into one
  graph (`koa-react-full-stack`).
- **A client class a project wrote itself.** A class is read as an HTTP client
  when one of its own verb-named members can be followed to `fetch` or `axios`,
  directly or through another member; that is evidence rather than a name, so a
  store with `get` and `delete` is not one. Where the chain leaves the class,
  `adapters.frontend.localClientClasses` names it. A base the class holds —
  `this.baseUrl = options.baseUrl || '/api'` — is folded into every address it
  writes, and a base a single call overrides with `{ baseUrl }` wins for that
  call. A verb called on a class of the repository that could not be read as a
  client, with an address written in the call, is an `api-client-unread` row
  (`react-local-client`, `react-client-base`).
- **A procedure is a boundary too.** A framework whose ways in are the *keys* of
  a tree of object literals — tRPC, and the family around it — is read, and each
  procedure is an entry point of kind `rpc` whose address is every key from the
  root of the tree down to it, which is the same string its caller writes.
  Guards inherited through a procedure definition in another file are read with
  it, and the file that mounts a tree either says which ways in it serves or
  produces a row naming itself (`trpc-router`). `adapters.entry.procedures`
  exposes the same description the shipped reader is written as.
- **Callers of a procedure are requests, joined by path.** `trpc.orders.list
  .useQuery(…)` and `client.orders.create.mutate(…)` are requests of kind `rpc`
  carrying the path and whether the server must have declared a query or a
  mutation. The linker joins them in the caller's own service, then in the
  services its `apiTarget` names, and nowhere else, because a procedure path is
  short and common; a call of the wrong kind joins and says so in
  `procedure-call-mismatch`. What a caller sends is not compared with what the
  procedure takes, and `contracts` lists every procedure boundary as unchecked
  with that reason (`trpc-join`).
- **An address is an address within one application.** A service that creates
  two applications — a NestJS API and a worker started by path, or a second
  Next.js application under `examples/` — serves the same path twice, and the
  second used to land on the first's id and vanish without a row. An entry's id
  now carries the application where a service has more than one,
  `entry:api@WorkerModule:http:GET:/health`, and nothing where it has one, so an
  ordinary service's ids do not move. NestJS applications are found by walking
  the repository for `NestFactory`; a file-system router's application is the
  directory in front of its root, and the one at the service root is `.`. A
  request records the application its file is written in, so a relative
  `fetch('/api/orders')` inside one application reaches that application's
  route. A request from outside every application is answered by deployment,
  which no source says, so it names both in an `ambiguous-route-application` row
  and chooses neither. A module whose controllers are spread from an array built
  elsewhere is a `module-controllers-unread` row, because membership now decides
  an address (`nest-two-applications`, `next-nested-apps`,
  `next-caller-application`).
- **A mount read from a setting every environment file leaves empty.** A route
  whose address begins with a part read from settings is never joined, because a
  hole may stand for anything. Where every committed `.env` file of the service
  leaves those settings empty or absent, the part is now taken as empty, as a
  browser's base read from a setting already is: the join is `heuristic`,
  carries `mountAssumedEmpty` on the edge, and writes an `info` row,
  `route-mount-assumed-empty`, naming the settings. One file that sets them, a
  service with no environment file, or a hole in the middle of an address keeps
  the old refusal (`nest-mount-empty`, `nest-mount-set`). A request that reaches
  no route only because of such a hole now names the route behind it rather
  than saying nothing serves it (`nest-context-path`).
- **Where a channel's name is written**, said as a list of locators rather than
  as an argument index. A description can now name a channel that is a property
  of an options object (`jobs.queue({ name, data })`, `@OnJob({ name })`) or that
  is the receiver itself, stated once in the `super(...)` of the class behind it.
  The vocabulary is the one the data layer already used to find a table name, and
  it is now literally the same type in the core rather than a second list that
  agreed with it. `channel` is available on a `producers`, `subscribers` or
  `consumers` entry of `adapters.broker.custom`, documented in `docs/CLI.md`;
  `channelArg` remains as the shorthand for argument 0 (`object-channels`).
- **Where a message sits inside what a call is handed.** `payloadPath` on a
  publishing call, and `payloadArg` and `payloadPath` on a described handler,
  locate the message inside an envelope. Without it the two ends of one channel
  were compared as they stood, and a correct handler was reported as requiring a
  field nobody sends.
- **A handler registered by a call has a way in.** A consumer found by pairing a
  `subscribe(channel)` with its listener, and a decorated handler no entry reader
  knows (`@Process`, a described bus's `@OnJob`), now get an entry and a
  `handles` edge like any decorated one, so what they receive is compared rather
  than reported as a receiver whose shape cannot be read (`fn-broker`).
- **socket.io, read from both ends.** `@SubscribeMessage` in a gateway and
  `socket.emit` in a browser are two ends of one channel, under the namespace
  the gateway declares. A namespace a server opens with `io.of('/live-videos')`
  is read too: both ends ask one function which endpoint the value a call is made
  on carries, through variables, fields, the transport's own chained calls and
  the connection a listener is handed (`socket-channels`, `socket-namespaces`).
  A stream is still not a channel: a browser holding one open never names what
  it is waiting for.
- **Every spelling of a Redis subscription.** The `redis` client spells the
  verbs `subscribe`, `pSubscribe` and `sSubscribe`; the description held two
  lower-case spellings matched exactly, so pattern and sharded subscriptions on
  that client were read by nothing. A subscriber's `method` may now be one name
  or several (`nest-redis-v4`).
- **Kysely**, where the connection is the whole database and every query begins
  by naming its table: `selectFrom('asset')` and the three calls beside it. The
  schema is in the connection's type argument and is not a table, so the
  descriptor says so rather than letting the fallback name one (`nest-kysely`).
- **The decorated form of a Sequelize model**, which is how a TypeScript project
  declares one: the table is in `@Table({ tableName })`, the model class is
  declared in the repository while the base it extends comes from
  `sequelize-typescript`, and `Model.scope('withOwner')` retypes the receiver to
  a name no reader could parse. All three are records now — an alias saying the
  two package names are one library, a decorator to read the table out of, and
  the list of calls that narrow a model and hand back the same model
  (`nest-sequelize-typescript`).
- **Drizzle, Mongoose, Sequelize and Knex**, where the table is named in the
  call rather than in a type — `from(users)`, `knex('orders')`,
  `Model.init(…, { tableName })`. A table assembled at run time is reported
  rather than guessed at (`nest-drizzle`, `nest-knex`).
- **A data layer read from what the source states.** Without `node_modules` the
  checker will not say what a receiver is, and every data layer read as nothing.
  An annotation still names the type and the import beside it names the package,
  and a model class of the repository names its base the same way, so those are
  read where a resolved type produced nothing, for a library something here
  describes. Every query read that way is `heuristic`; the same repository
  installed reads the same tables at `static` (`db-not-installed`).
- **A query builder an ORM hands over.** `manager.getKnex()` on a MikroORM
  manager returns knex, and every query after that call is knex's own. The step
  is a record beside the knex descriptor — this method, on something these
  modules declare, yields that library — so a project that reaches knex only
  through its ORM is read without naming knex in its manifest. Where the manager
  does not resolve, its type is read from the type argument, cast or annotation
  that states it, at `heuristic`. An alias written as an object,
  `knex({ il: 'inventory_level' })`, names its table
  (`nest-mikro-orm-knex`, `nest-mikro-orm-knex-not-installed`).
- **A service whose source you do not have.** A service entry may name a
  document instead of a repository, `document: { kind, path }`, and its routes,
  channels and shapes join and compare like any other end. `kind` is `openapi`
  or `asyncapi`, versions 2 and 3 of the second, including the fact that version
  2's `publish` means the service *receives*; the older `openapi: <path>`
  spelling still works. Every edge that exists because a document said so is
  marked `declared`, every party names the document, and every finding's
  sentence says the end was declared and not read. Nothing here checks a
  document against the service it describes, and the tool says so rather than
  implying otherwise (`multi-repo-declared`, `multi-repo-asyncapi`).
- **An HTTP framework described in configuration.** `adapters.entry.http`
  exposes the same description the four shipped readers are written as, so a
  framework nobody here has heard of can be read without a pull request. All
  four were rewritten as descriptions through that schema, which is what proves
  it rather than asserting it (`custom-http`).
- **A reading that placed some routes says how many.** `entry-http-routes-unplaced`
  says how many of the routes a reader read it could place at an address, so a
  service where three routes were placed and hundreds were not no longer looks
  like a service with three routes.
- **A file the parser cannot read says so.** It used to produce no node, no
  edge, no row and no mention — the count of files read was the only place it
  appeared, and it argued the opposite of the truth (`unreadable-file`).
- **A read without dependencies says so, once.** After the `unresolved` line of
  `extract` and `build`, and at the head of `doctor`, one sentence says that a
  repository's dependencies are not installed and that the read was partial,
  and what an install recovers: what a package declares, never what a package
  generates. It is printed only where there is no `node_modules` and something
  went unresolved.
- **`build` names a framework a service has only through a member**, on a
  `found at arm's length` line naming the member, because that is right when the
  member's code runs in the service and wrong when it only imports the
  framework's types, and the rule cannot tell the two apart
  (`next-sibling-nest-types`).
- **A harness that measures the tool against repositories nobody here wrote**,
  listed in a local, gitignored `scripts/coverage/targets.local.json` (shape in
  `targets.example.json`) and pinned at a commit, read fresh and with
  dependencies installed, counted by one rule written once, with a report per
  target and state written to be compared as a diff. The list, each target's
  exemptions and the reports stay on the machine that measures: they name other
  people's repositories, which this project does not.
  Its read gate — a file with a route, a screen, a click or a query in it must
  yield a node or a row naming the file — also runs over every fixture as the
  last step of `pnpm fixtures:check`. `docs/coverage.md` describes it.
- Four gates: **I2**, no raw control character in any file; **I12**, no
  extractor reachable from a sibling extractor; **I13**, every reason a row
  carries is a reason `doctor` knows; **I14**, the coverage harness and the tool
  agree about what a service is. Each was watched failing before it was trusted.
- **A fixture's run is held whole.** An output a fixture's run writes that no
  snapshot holds is a failure rather than a silence, every project fixture's
  contracts report is a compared snapshot, and a fixture whose build is not yet
  trusted as an expectation is named in `UNHELD` with the disagreement, printed
  on every run.
- **A Prisma call with no generated client.** A fresh clone has no
  `prisma generate` output, so `prisma.booking.findMany()` had no type and was
  not a query. The client is now followed through the import that binds it,
  including into an unlinked workspace package, and a module that does not exist
  counts as the Prisma client only where a `schema.prisma` names it as a
  client generator's output. The model maps to its table by `@@map` when the
  schema is readable. The context object tRPC hands a handler, a destructured
  client, a narrowed type (`Pick<PrismaClient, 'order'>`) and a client loaded by
  `await import()` in any of its three spellings are read. Every edge is
  `heuristic`, and a local value merely named `prisma` is never read
  (`prisma-not-generated`).
- **The SQL handed to `knex.raw`** is read with the reader a driver's query
  text is read with. A `raw` handed to another call of the same builder is part
  of that query, not a second one (`nest-knex-raw`).
- **A request-reply message compares its reply**, the way an HTTP call's
  response is compared: `client.send<OrderDto>(…)` and an acknowledgement
  callback's parameter are the receiver's side, the handler's return the
  sender's, through the same comparison (`multi-repo-contracts`, and the
  Angular socket reader in `socket-channels`).
- **A workspace package imported by its name, with nothing installed.** The
  package's manifest `exports` (exact subpaths, then `*` patterns) or its
  `types`/`module`/`main` is followed into its source, after an installed copy,
  the service's own aliases and the package's own. Only packages the service
  declares resolve (`workspace-package-by-name`).
- **A handler built by a factory of the repository.** `export const GET =
  handlerBuilder` and a route registered with `makeHandler(config)` point at the
  factory, followed through up to four re-bindings, instead of raising a
  `route-handler-unread` row (`next-hollow`).
- **`readTestDirectories`** on a service entry: directories named like tests
  that hold code the application runs, read after all (`nest-test-directories`).
- **A repository base says where its classes name their table.** An entry of
  `adapters.db.localBaseClasses` may be `{ "name": "BaseRepository",
  "tableProperty": "collectionName" }`, and every call through a class extending
  it then reads the table that class sets the property to, as a literal or a
  constant, ahead of its type argument. Inside such a class, a query made through
  `this` (`const c = await this.coll(); c.find(…)`) is on the class's own table.
  A query written inside the base runs for every subclass and is an `info` row
  saying so (`nest-mongo-tables`).
- **The project site says what the tool reads, and lists every fixture.** The
  landing page names every framework, data layer and broker it reads, grouped
  by area, and a new page, `fixtures.html`, lists each fixture with the sentence
  from its README saying what it proves. That page is generated from the
  fixtures, and `pnpm check` fails when it is out of date.

### Changed

- **What stands in front of a way in is an edge.** Middleware read off a
  registration was `meta.middleware`, a list on the entry, while a NestJS guard
  was a node and a `guarded_by` edge, so everything that reads the graph as a
  graph — the route audit, `impact`, `flow`, the settings walk — saw
  call-registered routes as having nothing in front of them. Every reader now
  draws a `middleware` node and a `guarded_by` edge with `meta.order`, tRPC
  procedures and Medusa routes included; a Medusa chain is ordered the way that
  framework runs its list. `meta.middleware` is gone; `meta.middlewareRead`
  stays, and stays `false` on Medusa routes, whose framework authenticates
  `/admin` and `/store` in code this does not read.
- **`SCHEMA_VERSION` is 5.** A graph written by an earlier version is refused
  with a message saying to rebuild, rather than half read. Nothing needs doing
  beyond a rebuild.
- **A word out of a configuration file no longer indexes a plain object.** The
  tables that say which reader reads a repository of a given `type`, which one
  reads a document of a given `kind`, and which arguments a marker gives as
  names are `Map`s. A misspelled type or kind was answered with whatever the
  language puts on every object — `constructor` had a reader — and is now
  answered with nothing, which is what a misspelling deserves. `DOCUMENT_READERS`
  is exported as a `ReadonlyMap` rather than an object. A service may no longer
  be named after a property every object has.
- **The control-character gate reads every file in the repository**, in any
  language, rather than `.ts` and `.tsx` under one directory. The file that
  carried two raw NUL bytes — and so went invisible to `grep` — was a script,
  which the gate written for exactly that failure did not cover. What it covers
  and what is exempt are two lists in `scripts/invariants.sh` with a reason
  beside each.
- The `doctor` reason for how old a declared service's document is, was
  `openapi-document-age` and is now **`document-age`**, with the kind of document
  named in the row. There are two kinds of document now and the reason named one
  of them. A reason is configuration surface — it is spelled by hand in
  `doctor.ignoreReasons` — so the old spelling goes on being recognised there and
  nothing has to be edited; write `document-age` in new configuration.
- **A route under a mount whose path could not be read has a reason of its
  own, `route-mount-unread`,** rather than `route-path-dynamic`. The route's own
  path was read; what was not is the path its application is mounted under,
  which is fixed somewhere else and usually by someone else. `route-path-dynamic`
  now means only that the route's own path is computed. A row moves from one
  reason to the other, so a configuration that silenced these rows with
  `route-path-dynamic` in `doctor.ignoreReasons` shows them again: add
  `route-mount-unread` to keep them silent. The old spelling is deliberately not
  treated as covering the new one, because the two are different facts and
  silencing one says nothing about the other. `route-path-dynamic`'s own hint is
  rewritten for what the reader now folds — a `+` or template of constants, and
  a list of paths — and says that such a route is missing, not merely unmatched.
- **`doctor` refuses a graph nobody could report on, with exit 2 and without
  `--strict`.** Four graphs: one holding no node at all, one whose build
  recorded that a repository could not be read, one a service was read into and
  contributed nothing to, and one where most of a service's ways in have no
  handler that was read. This is a change to what a CI job fails on, and it is
  deliberate: 2 has always meant "the check could not be run", which is exactly
  what these are, and every one of them used to answer `unresolved: total=0 …
  none`, exit 0. The last is decided per service and past half, because the
  growth check sees a change only when it adds a row, and a change inside a body
  nobody read never does; below half, the unread handlers are ordinary rows and
  `doctor` prints the two numbers above them. It does not wait for `--strict`
  because a run without the flag still answers a question, and "healthy" is not
  an answer anybody asked of an unread graph. `--accept` refuses the same four
  (`next-hollow`).
- **A build that failed leaves the graph the last good build wrote.** It used to
  write its own answer — the project minus whatever could not be read — over the
  top, which is indistinguishable from a project that really is that small, and
  is how a crash in one dependency's type declarations came to be reported as a
  clean bill of health. The failure is on stderr and in the exit code; where
  there is no graph to keep, the partial one is written with the failure recorded
  against the service beside it, and `doctor` refuses that.
- **`build` counts ways in apart from ways in whose body was read**, in a line of
  its own, because only the second number is coverage of what happens after a
  request arrives. `doctor` reads the same count, from the same function.
- **A receiver named `store` is no longer read as a data layer.** It was the last
  of the name hints, used only where the types say nothing, and across the
  repositories the coverage harness reads it produced rows of which none was a
  data layer: arrays, maps, mutex and plugin registries, a browser object store,
  a framework's cookie store, and the state stores front ends keep their screens
  in. Where it went it took one invented table with it, named after a state
  type. A *type* called `OrderStore` is still read as a data layer, which is the
  half of the hint with a class behind it.
- **A service is an application together with the workspace packages it
  declares**, rather than a directory with a manifest. Pointed at a Next.js
  application in `apps/web`, the tool used to find every route it answers and not
  one of the functions those routes call, because the handler bodies are in
  `packages/features` and `packages/lib` and those were opened only so that types
  would resolve; pointed at the monorepo root it found the bodies and no way in,
  because the root has no application in it. There was no configuration that gave
  both. The extent is now read from `workspaces` or `pnpm-workspace.yaml` and
  needs nothing written down: the application's directory stays its identity and
  the directory every path is measured from, and a file of a package it reads is
  named as one — `../../packages/lib/orders.ts`, where the absolute path of
  whoever ran the tool used to be (`next-monorepo`).
- **The extent stops where the package manager stops.** A member's
  devDependencies are installed only when that member is the one being worked
  on, never for whoever depends on it, so a member is followed through
  `dependencies`, `peerDependencies` and `optionalDependencies` only; the
  service's own manifest is still read in all four sections, since its build and
  its tests live there. A browser tool a library keeps as a devDependency no
  longer switches React on for the server that uses the library
  (`nest-dev-sibling`).
- **`init` derives the service list from the workspace.** A repository that
  declares one is read as the several services it holds: one per member that
  looks like an application, and none for the packages those applications import.
  A member that declares nothing of its own takes the workspace root's manifest
  for the question of what it is, which is the ordinary shape of a server whose
  dependencies are kept at the root, so `init --dir .` over a repository holding
  a server and its browser writes both halves. A repository that declares no
  workspace, and a workspace with no application in it, are one service exactly
  as before.
- **`confidence` has a fifth level, `declared`**, ranking below `marker` and
  above `heuristic`. An annotation is written by somebody who can see the code;
  a document is written by somebody who cannot see yours. Before this, a third
  party's self-description wore the same word as an annotation in your own
  source.
- **A join is no stronger than the route it reaches.** It takes the weaker of
  what it found and what the route is: `declared` where a document declared the
  route, `heuristic` where the route was read off an application recognised only
  from its source, and `heuristic` where a mount was taken as empty.
- The rebuild plan hashes a graph's body rather than the file, so the clock
  inside it no longer makes every reading of an unchanged tree look like a
  change. A graph reprinted with different whitespace now plans `skip`.
- A repository node reports files opened, files read, and the difference,
  instead of one number that counted what it could not read.
- `contracts.json` is at format version 4: a party can name the document that
  declared it, and a reader that did not know would present a declared end
  exactly as it presents a read one.
- Two rows' sentences describe the case that produces them:
  `unknown-db-operation` names a query text that does not open with a verb the
  reader knows, rather than asking for a change to a descriptor that already has
  it, and `route-handler-anonymous` names both shapes that reach it — a handler a
  package's call hands back, and one a factory of the repository builds from a
  function it is handed. Neither reason string changed.
- **A test directory is reported rather than silent.** A directory named like
  tests (`test`, `tests`, `e2e`, `fixtures`, `cypress`, `playwright`,
  `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`) is still not read,
  and each one now carries a `test-directory-skipped` row at level `info` with
  the number of source files it held. An `info` row that counts its own sites is
  no longer folded into one row per reason (`nest-test-directories`).
- **The coverage read gate counts an edge or a row only for its own family.**
  A file with query sites no longer passes because one of its functions calls
  another: `queries` answers for data, `handles` from an entry for routes, and
  so on, from one table. An edge's file is placed by the service that drew it.
  The gate also runs over fixtures that keep only a project graph, with
  services declared only by a document set aside by a stated rule.
- **The browser reader reads a file only where the framework is supplied to the
  package that holds it**: by the service, by the member's own dependencies, or
  as a peer by whoever depends on it. A Node API that renders e-mail with React
  no longer has its own server code read as a browser's
  (`nest-rendered-mail`, `nest-member-dev-react`, and `nest-member-angular` for
  the Angular reader).

### Fixed

- **A fixture snapshot nobody compares now fails the gate.** The snapshot check
  decided a fixture had sources by looking for a `src/` directory and pointed the
  comparison at a path that does not exist when it found none, so a Next.js
  fixture laid out with `app/` was validated for shape on every run and compared
  never. A fixture is now found by what it declares, in one table shared with the
  script that runs them, and every snapshot in the gap between the two counts the
  gate prints must be a fixture named with the reason it is validate-only, which
  the gate prints. One is; an entry that no longer applies fails too.
- **Adapter detection follows the members a service declares.** A service's
  extent is its own directory plus every workspace member it declares,
  transitively, and the sources of those members are walked exactly like its own
  — but the manifest an adapter is offered was widened only upwards and
  downwards, never sideways. So a monorepo where the application declares a
  library and the library declares the framework switched the adapter off while
  the framework's code was in the graph. The chain now asks the same question the
  extent does.
- **Adapter detection reads the workspace a repository belongs to.** It asked
  the service directory's own `package.json`, and in a workspace that manifest
  is usually a name, a version and an exports map with no dependencies in it at
  all: every adapter switched off and the repository was reported with no
  routes, no channels and no data layer, which is indistinguishable from a
  repository that has none. The question is now answered off the whole workspace
  chain — the directory's own manifest, any manifest above it that lists it as a
  member through `workspaces` or `pnpm-workspace.yaml`, and, where the directory
  is itself a workspace root, the packages inside it whose sources are read as
  part of it — and `adapters.force` is no longer the only way to read such a
  repository. A service's *type* is still guessed from its own manifest first,
  so a package that declares Express is not read as React because the monorepo
  around it has React in its tooling (`workspace-leaf`).
- **A workspace package's own path aliases resolve its own imports.** A service
  compiles the packages it declares with its own `tsconfig.json`, so a package
  importing its own code through an alias only its own configuration defines
  resolved nothing, and the class behind it was never reached. An import written
  in such a package is now resolved with that package's `paths` first
  (`workspace-package-paths`).
- **A NestJS bootstrap is asked of the package itself.** A Next.js application
  that imports a package of Nest DTOs was told to set `services[].bootstrap` for
  a Nest application it will never have, because the question "is this a Nest
  application" was asked of the manifest widened along the workspace.
- A reader that runs out of memory says so, and is given a heap it can finish in.
  A large monorepo with its dependencies installed exhausted the default heap and
  the build reported three addresses inside a dynamic library, because the words
  "JavaScript heap out of memory" are forty frames above the tail that was
  quoted. A repository read now gets a share of the machine, divided by how many
  repositories are read at once and never less than the runtime would have
  given, and `--heap` or an existing `NODE_OPTIONS` limit wins over that. A read
  that still does not fit names the repository, the limit that did not hold and
  the flag that raises it, and leaves exit code 2 — the code this command line
  uses for a check it could not run.
- Installing dependencies invalidates the build cache. The plan keyed on source
  hashes, the configuration and the tool's own version, so clone, build, install,
  build printed `cached (0 files changed)` and served the graph read without any
  types resolved. What is installed for a service, over the same extent the
  reading uses, is now part of what the plan compares, so the second build
  re-reads and says `dependencies installed in .` for why. The lockfile is hashed
  and the modification time of `node_modules` is deliberately not read: a clock
  inside something the plan compares is a defect this project has closed once
  already.
- A type reference whose object key is not a name round-trips. The writer emitted
  keys as they were written and the reader refused them, so a dependency
  declaring JsonLogic operators — `{ '<=': number }` — stopped every command that
  parses a reference, and a build of a repository depending on it read nothing.
  Keys that are not names are quoted, quoted text carries a backslash escape, and
  a property test generates references from the grammar and holds the reader to
  reading back exactly what the writer wrote.
- A Next.js verb that is exported and whose body could not be followed is a row.
  Only a file exporting *no* verb raised one, so a verb assembled by a helper —
  `export const GET = restHandler(config)`, the dominant spelling in the
  ecosystem's largest repositories — produced a way in, sometimes a `handles` edge
  onto a node with nothing in it, and no mention anywhere (`next-hollow`).
- A service that was read and contributed no node is named by `build`, with why,
  and is a row `doctor` reports. The project already argued that knowing the name
  of a stack it cannot read is worth as much as knowing one it can; that argument
  was applied to a repository with no reader and not to this case, which is the
  one that looks like success — a reader that opens the repository, a registry
  that recognises none of it, and an empty graph nobody is told about.
- **No node is minted from a value the same reader called unreadable.** A table
  is no longer taken from the type argument of a package nobody has described, or
  from a type argument the repository does not declare — a library's own generic
  helper once put nearly every query of a server on one table node — and a
  receiver recognised only by its name no longer produces a query, only the row
  saying what to write to make it one. A channel is no longer named after a
  record that carries a payload. Nothing that stopped minting stopped reporting
  (`nest-unknown-orm`).
- An alias over a library's type no longer hides the library. An intersection
  with a name of its own answers for itself, which is right when a framework
  declares the name — its read-only cookie store is written that way — and wrong
  when the repository being read declares it, as in `type AuthedSocket = Socket &
  { user: User }`, where every listener registered on it went unmatched. The
  alias is now preferred only where the alias itself comes from a package; both
  halves have a test.
- A write through a connection parameterised by the whole schema no longer
  registers the schema as the shape of the row it wrote. The same fabrication as
  reading a schema type as a table, one field further along.
- A query written in a module-level function is read. The leaf walk read the
  methods of the indexed classes and nothing else, so a `pool.query(…)` or a
  `db.select(…)` in a module of exported functions — the shape most TypeScript
  that is not Nest is written in — produced no node, no unresolved row and no
  report: nothing at all. Functions declared at the top of a module, arrows
  assigned to a const, functions nested in either, and handlers written in the
  registration are now read exactly as methods are, and a body is read whether
  or not anything calls it. A query at the top level of a module, which belongs
  to no function, is a `db-call-at-module-level` row (`fn-data-layer`,
  `fn-broker`).
- A call into a function that holds a request, a query or a setting is drawn.
  Such a function was a node with nothing calling it and nothing it called:
  the call walk runs before the leaf readers and follows a function by name only
  from an entry point's handler. A call to a function of the service is now
  drawn when that function leads to something the graph holds, from a method, a
  function or a handler alike, and a helper that reaches nothing held stays out
  (`nest-held-calls`).
- A function written in place in a module's own statements is a body like any
  other: `export const bookingsProcedure = authedProcedure.use(async ({ ctx }) =>
  …)` holds the queries in it, under a node named for where it is
  (`bookingsProcedure.use@20`), which is also the node the way in's `guarded_by`
  edge points at. A tRPC handler's or guard's `ctx` is read from the type the
  root was created with, `initTRPC.context<…>()`, and a transaction's `tx` as the
  client it was handed by, both with nothing installed
  (`trpc-inferred-context`).
- A test is not read, and what a test is is one definition the coverage
  harness counts by too: a name with a `test`, `spec` or `e2e` part
  (`*.integration-test.ts` and `*.e2e.ts` included), or a directory only tests
  live in (`__tests__`, `playwright`, `e2e` and a few more). The tool read
  A scheduling app's whole `playwright/` directory before (`trpc-inferred-context`,
  `nest-rendered-mail`).
- A write records the document it stores whether or not the entity's name had a
  wrapper suffix to strip. `Repository<OrderEntity>` recorded it and
  `Repository<Order>` did not, so `stripImpact` answered `unknown` — the answer
  meaning "I could not tell" — for every field a validation pipe strips in a
  project that does not suffix its entities.
- A chain carrying two operations — `knex.select('id').from('users').first()` —
  is one query and is counted once. Every link of a chain is written at the same
  position and so lands on one node, which is right, but the internal count of
  queries counted the emissions; that count is what decides whether to report a
  repository whose data layer nobody could read.
- A relative request reaches its own service's route. `fetch('/api/thing')`
  names no service and is rooted at no settings key; it means the server the page
  came from, and that was the one service struck out of the search. It is now
  resolved against the routes of the service it was written in, after a target
  named outright and a settings key a service claims, and before any guess, with
  `via: "same-service"` on the edge.
- A NestJS address is the one the framework prints at start-up.
  `setGlobalPrefix` and `enableVersioning` are looked for anywhere in the
  repository once the entry file has not made them, and adopted only where no two
  files disagree; under URI versioning the version is part of the path, a route
  naming none takes the application's `defaultVersion`, and `VERSION_NEUTRAL` has
  no version segment. Two controllers for one resource at two versions used to
  land on one entry and be reported as a route claimed by two handlers
  (`nest-addressing`).
- A decorator imported from a subpath of its package, `@nestjs/common/decorators`,
  or under an alias, `import { Get as HttpGet }`, is read; a decorator spelled
  like Nest's that arrives through a barrel of the repository's own is a row
  naming the class rather than a controller with no routes (`nest-subpath-imports`).
- An address written with a `+` is read, and so is one a static field holds.
  Two string literals added together were unresolvable, and a field read off the
  class name rather than off `this` was not read at all
  (`angular-static-base`).
- The route audit no longer tells a reader that middleware installed for a whole
  prefix went unread when it was read. The caution was raised for any route
  registered by calling an application, which was fair while the only such
  reader was the one that does not read installs, and stopped being fair when
  three that do arrived. A route now says whether its reader read them, and the
  audit asks that: an Express, Fastify or Koa route with nothing in front of it
  is an ordinary finding again, at the level it deserves.
- Middleware a Hono worker installs for a whole prefix is read, as it already
  was for the other three. `app.use('*', requestLogger)` reaches every route
  below it, through a mount and through an application handed back by
  `basePath`, which answers through the one it came from.
- A route declared as `app.route('/books').get(handler)` is read. The path is
  written on Express's `IRoute` rather than on the application, so those routes
  produced no node and no row: they were simply absent, which is the worst way
  for a reader to fail.
- A repository that is not a NestJS one is no longer told to set
  `services[].bootstrap`. The same reader opens Express, Fastify and Koa
  repositories, and `bootstrap` names a NestJS file; the row was a finding
  nobody could act on, in a list whose worth is that everything in it can be.
- The build stamp the graph cache is keyed on covers every reader package,
  derived from the dispatch table and this command's own dependencies rather
  than written out by hand. The hand-written list had missed a reader, so a tool
  rebuilt with it answered from the cache written before that reader existed —
  a real change read as no change.
- A receiver whose type is an intersection has an origin. Every modern database
  driver hands out its client as one, so a whole data layer resolved to no
  package and no table, every query a guess made on the name.
- An exported const built by a call is a function. A server action or a route
  handler written `export const GET = withWorkspace(…)` had no node, so every
  caller of it reached nothing and nothing it called was on the graph at all.
- A verb aliased to another verb, a built value re-exported under two names,
  and a destructured built export are each read as the handler they name.
- A route file that forwards a verb from a package names one position. Its entry
  carried the route file with the line of the module that declared the verb, a
  pair that often names a line the file does not have; the entry now records the
  file it was reached through and the line that forwards it, and the declaration
  separately (`next-reexport`).
- A build that fails stops its readers before it returns. It settled on the
  first failure and left the others running, so an abandoned extraction went on
  writing into a repository — invisible in the command, which exits, and not
  invisible to a watch, an embedder or a second build.
- A whitelisting pipe on an array body produces the findings it produces on an
  object body. The check that exists to notice a stripped field said nothing at
  all for a `Dto[]`, and a nested field path is now walked rather than answered
  `unknown` without having been compared.
- A hint no longer says a type was declared in this repository when the same row
  says it came from a package, and a row about a receiver whose type a workspace
  package of the project declares names that package (`nest-workspace-wrapper`).
- **A name every object has no longer breaks a reader.** `this.bot.toString()` on
  a Telegraf receiver was looked up in a table of registrations and found the
  language's own function, and the whole repository was skipped as
  `extract-failed`. The same class of lookup crashed the NestJS bootstrap reader
  on `process.env.hasOwnProperty('PORT')` in an entry file, and recorded
  `cache.hasOwnProperty('status')` as a cache operation. Every table asked about
  a word from source is a `Map` or asked through `Object.hasOwn` (`bot-registry`,
  `fn-data-layer`).
- **An Angular route configuration is recognised by its shape, and a lazy one is
  opened.** A route array was taken only from a declaration annotated `Routes` or
  from an argument to `forRoot`, `forChild` or `provideRouter`, and `loadChildren`
  was deliberately not followed, so a router written as bare `export default [ … ]`
  files mounted through `loadChildren` was mostly unread, what was read sat at the
  wrong prefix, and no `routerLink` reached a screen. An array is now identified
  by what is in it, `loadChildren` is followed to the module's default export or
  to the `forChild` in the `NgModule` it names, a `path` arriving through an
  object spread is read, and an array spread into a list of children is spliced
  in where it stands. What is left is almost entirely a link written relative to
  the route the component is mounted at, which is a different question and is
  still reported (`angular-lazy-routes`).
- **A template local is no longer reported as a method the component forgot to
  declare.** `<ng-template let-hide="close">` binds `hide`, and looking for it on
  the component found nothing and said so. Every name the template itself binds —
  a `let-` context field, a `#ref`, a `@for` item, an `@if` alias, an `@let` — is
  now read as a local, and a binding on one is the nothing-to-point-at case it
  is, naming the local. A binding that genuinely names a missing method is still
  a row.
- `fetch` in an Angular service is a request. The platform's client is described
  once, in the core, and the Angular and React readers both read it through that
  description (`multi-repo-analytics`).
- A constant typed `: string` sends the value it was written with; the type
  widens the type, not the value. A parameter or a `let` is a run-time value and
  says so, rather than being reported as a constant nobody could read
  (`nest-kafka`).
- `@Transform(fn)`, and `@Expose` or `@Type` with an argument nobody can read, is
  a `decorator-arg-dynamic` row at the decorator (`nest-types`).
- **A token a configured module provides is provided.** `ClientsModule.register(
  [{ name: 'KAFKA_CLIENT', … }])` registers its client under that name; the
  token was reported as provided by nothing. It now resolves to the installed
  `ClientProxy`, and calls through it are counted as calls into the package
  (`nest-kafka`, `nest-rabbitmq`, `multi-repo`).
- **A parameter forwarded through an interface method reaches only the callers
  of that implementation.** One calendar's URL was forwarded to every other
  calendar's `this.deleteEvent(…)` call through the interface they share, which
  lost the real request and put wrong ones in its place
  (`nest-interface-dispatch`).
- **A forwarded request keeps its own verb and host.** `fetch(url, { method:
  'PUT' })` credited to its caller read as `GET`, and a whole-URL template lost
  its host to a path starting `/https:/`. A request's settings object is no
  longer recorded as its body type (`nest-forwarded-verb`).
- **A statement that names no table is not a failure.** `SELECT 1`, `BEGIN` and
  `COMMIT` wrote `sql-parse-failed`; they are counted and write nothing
  (`pg-no-table`).
- **A described handover on a value whose type was erased is said.**
  `(context.manager as any).getKnex()` is not read, because `any` may be
  anything with a method of that name, and it used to be silent; it now writes
  one `db-handover-unstated` row per query (`nest-mikro-orm-knex-not-installed`).
- **A MongoDB collection is read where the driver names it.**
  `db.collection('orders').find()`, and a `const` bound to
  `db.collection('orders')`, name `orders`. The driver's type argument is the
  shape of a document, and reading it made a table called `Document` of every
  untyped collection; it is no longer asked (`nest-mongo-tables`).
- **A query with no table says what would read it.** Through a repository base
  named without `tableProperty`, the row names that key rather than asking for
  the call to be rewritten.

## [0.4.1][] - 2026-09-22

`@flowatlas/cli` only; `@flowatlas/markers` is unchanged at 0.2.0.

Three readers that were written when a producer had one channel, found by
exercising 0.4.0's folding as a project rather than as a unit test.

### Fixed

- A producer that reaches several channels is now read as such everywhere, not
  only in the graph. `doctor` reports **every** annotation that restates a
  channel the code already yields, where it used to report the first and leave
  the rest of them unmentioned; and a producer is labelled with the channels it
  reaches rather than with the wildcard pattern they share, which is how an
  annotated producer has been labelled since 0.4.0.
- A receiver whose type is a named union of string literals — `state: OrderState`
  where `OrderState` is `'A' | 'B'` — no longer produces a row saying the
  receiver could not be followed and suggesting a class be injected. It is the
  language's own `string`, whether or not the set was given a name. Naming the
  set in the type is what 0.4.0 recommends instead of an annotation, so it had
  better not be the spelling that produces rows.

### Added

- `fixtures/folded-channels`, which exercises the folded template across two
  repositories: one publishes `` `order:${id}:${verb}` `` with `verb` derived
  from a union-typed parameter, the other handles the three names that reaches.
  Deleting the three `@Emits` from it leaves the channels unchanged, which is
  the claim 0.4.0 makes, now checked rather than asserted.
- `docs/media/12-folded.gif`, the same story recorded.

## [0.4.0][] - 2026-09-21

`@flowatlas/cli` 0.4.0 and `@flowatlas/markers` 0.2.0, which moves for the
first time since it was published: the channel and call annotations take a list,
and that is a change to their signatures.

0.3.0 stopped the tool claiming things it had not checked. This does the same
one level down: the lists it produces are now short enough to read by hand, and
reading them by hand showed that the last few rows were wrong. Measured on the
five-repository project this is developed against, same configuration, same
commits: the one row saying a front end asks for something the back end does not
serve is gone, and it is gone because the two routes joined; the one contract
error is gone; findings to act on went from 30 to 22; contract warnings from
1,069 to 1,014; and four routes that read as having no guard now say that
somebody took the guard off on purpose. A channel that never existed — a
template wildcard standing for three real events — is gone too, which took the
project from 18 channels to 17.

### Added

- A path segment written as a closed set of strings — a parameter typed
  `'ship' | 'refund'` — is matched as each value as well as as a hole. Where
  every value reaches a route, the call joins to each of them; where some do and
  some do not, the finding names the value nothing serves, which is what a
  renamed handler looks like from the other side. A union of more than twelve
  values, and a segment typed `string`, are read as a hole exactly as before.
- `/** @flowatlas-auth <how> */` on a NestJS handler says that the handler
  checks the request in its own body — a signed header resolved inside the
  method, a service token checked by hand — and the route audit then says
  nothing about it. Unverifiable, like every marker, and documented beside
  `@flowatlas-calls`.
- `route-guard-skipped`, for a route whose guard a decorator named under
  `doctor.skipGuardDecorators` switches off. Reported at `info`, and it does not
  ask for the same decision to be written a second time under
  `doctor.publicRoutes`.
- A `whitelist-strip` finding carries an `impact`: `none` when the receiving
  handler reaches no write and therefore cannot lose data, `stored` when it
  writes a document that declares the field, `unknown` otherwise. The `none`
  rows are counted on one line rather than listed — 25 of 56 on that project —
  and every one is still in `--format json`.
- `@Emits`, `@Consumes` and the routes of `@CallsService` take a name, several
  names, or a list of them, and every form means what a stack of single
  annotations means. **This is a signature change in `@flowatlas/markers`**, so
  the list forms need 0.2.0 of that package to compile and 0.4.0 of the command
  to be read; every existing annotation keeps compiling and keeps meaning what
  it meant. A project that keeps its channel names in one catalogue can
  reference it whole; the array has to be written down rather than assembled,
  and one assembled at run time is reported rather than read as nothing.
- `marker-arg-not-a-name`, for an annotation argument that resolved to
  something that is not a name, and `marker-names-nothing`, for one given
  arguments and left naming nothing. Both were silent: `@Emits('a', 'b')` kept
  `a`, `@Emits(['a', 'b'])` kept neither, and on a method that really does
  publish — the only place anyone writes the annotation — nothing was said at
  all. An annotation that fails quietly is worse than no annotation, because
  whoever wrote it believes the tool agreed with them.
- A template hole whose values can be worked out is no longer a hole. A channel
  addressed as `` `ticket:${id}:${verb}` `` where `verb` derives from a literal
  union through plain string work — `slice`, `toLowerCase`, `replace` and the
  rest of a closed set, plus `+` — is folded to one channel per value. The id
  stays `*`, because it is genuinely unknowable. Nothing is folded half way: a
  step that cannot be applied exactly makes the whole hole a hole again, since
  inventing a channel nobody publishes to would be worse than saying `*`.
- A hole whose value is typed as a union of string literals is read from that
  type, wherever the value is written: a local, a function's return, or the call
  written straight into the template. Typing the value is better than annotating
  it — the compiler checks it, renaming a member updates it, and it cannot drift
  from the code because it is the code.
- An `as const` array declared in a shared package is read. A string const from
  such a package already resolved — a declaration file carries the value in its
  type — and an array is a tuple of literal types, which was one branch short.
  A member that is not a string or a number makes the whole array unresolved
  rather than partly read.
- A method written as a field is followed in four more places, which 0.3.0
  scoped itself out of: a lifecycle hook written as `ngOnInit = () => {}` is
  read as the hook the framework will call, a request forwarded through a
  wrapper written that way is followed to its callers, and a registration that
  delegates to `this.handle()` finds a field holding an arrow — which is how a
  handler keeps its `this` when a library holds it. The one place still asking
  narrowly says why in its own source: a route, a message pattern and a cron are
  registered by a decorator on a *method*, and a decorator on a property
  registers nothing at all.
- A contract party carries `writes`: the top-level keys an object written in the
  source actually puts on the wire, where there is one to read, and
  `writesEvery`, false when those keys are one object per caller rather than
  one object. Three callers writing `{ role }`, `{ isActive }` and
  `{ permissions }` put all three keys on the wire between them and none of
  them on every request, so a message about those says "sent by some of the
  calls" rather than "always sent".

### Changed

- A producer named by annotation carries every channel it publishes in its
  label, rather than whichever channel was read first. A stack of annotations
  always shared one producer node; now the node says so.
- A request-direction finding about a key a call's declared type permits but
  nothing writes is no longer reported. A declared parameter type says what a
  call may send; an object written at the call site, in a `const` a line above
  it, or by the one caller of the method that makes the request says what it
  does send — and where several callers each write one, their keys together. A
  spread of a wider object into a literal still puts its keys on the wire and
  is still reported. 28 rows on that project, all of them a client echoing back
  a key the server owns.
- A message about a shape read from a declared type says "permits" rather than
  "sends", and never "always sent". Response and payload wording is unchanged.
- A finding on one arm of a handler that answers with a choice of shapes names
  that arm, and a missing field counts the arms that carry it: "it is on 1 of
  the 2 shapes this may answer with, and not on `{order,payment}`".
- A row an annotation has already answered is `info` rather than something to
  act on, in the count, the grouping, the fold and the baseline alike. Acting on
  every row a run reports now takes the number to zero. What counts as answered
  is the shape the graph takes once the annotation worked, and the shapes
  differ: `@CallsService` draws one edge out of the method it is written on, and
  `@Emits` draws two — the method reaches a producer, and the producer reaches
  the channel — so a channel row an annotation had plainly answered used to keep
  asking for the annotation. An annotation that names nothing answers nothing,
  which is this and the marker reading agreeing. A browser request is the third
  shape: `@flowatlas-calls` does not repair the request it sits above, it adds
  one that joins, so the row is answered only where the annotations on that
  method are at least as many as its unreadable requests — two unreadable
  requests and one annotation keep both rows, and the hint says why rather than
  asking again for an annotation that is already there.
- A group of unresolved rows is headed by a sentence true of every member — the
  members' own where they agree, and otherwise the kind's — instead of whichever
  member's sentence the most rows happened to share. A member's own sentence is
  marked so it belongs to the place above it, and a group is keyed by reason and
  level, so a group's level is every member's.
- `contracts` output is ordered worst first, as its own documentation has always
  said it was, with the strips that can lose data above those that cannot.
- `contracts --format json` is at format version 2: a party may carry `writes`,
  a finding may carry `impact`.

## [0.3.0][] - 2026-09-20

`@flowatlas/cli` only. `@flowatlas/markers` is unchanged at 0.1.1.

Everything here was found by reading the tool's own output on the project it is
developed against, and most of it is about saying true things rather than
reading new ones. Measured on that project, same configuration, same commits:
browser requests matched to a route went from 489 of 495 to 493 of 499, routes
something reaches from 502 to 506, and the routes nothing appears to call from
62 to 58 — of which 14 are declared public and 7 are health probes, leaving 37
worth reading. The lists a person actually reads got shorter without anything
being hidden: 721 unresolved sites became 321 that say something was not read
and 397 that say nothing joins there, and 1,445 field rows became 63 the
receiving side really throws away.

### Added

- A repository built on a framework there is no reader for is named, by `init`
  when it writes the configuration and by `build` on every run: Express,
  Fastify, Koa, Next.js, Nuxt, Remix, React, Vue and Svelte. It stays in the
  configuration and contributes nothing to the graph, which is now said rather
  than abbreviated to `no-extractor`.
- A third level for an unresolved row, `nothing`, for a place where no edge
  exists to draw — a template binding that assigns to a field has no method
  behind it. Counted apart from the places it could not read, in `build`, in
  `doctor` and in the baseline. On the project this is developed against that is
  397 places that were being counted as gaps and are not.
- `dead` gives a route nothing calls the reason it is in the list: declared
  public under `doctor.publicRoutes`, a health or status probe, an event stream,
  or nothing of the sort, and orders them so that the rows nothing explains come
  first and `--max` cuts from the other end. Of the 58 rows on that project, 21
  are one of the first three and 37 are worth reading.
- A request made through a wrapper that remembers what it was given —
  `this.params = { url, key }`, opened later from `this.params` — is followed to
  the caller that wrote the address. A field two places write is refused rather
  than guessed at. On the project this is developed against that is five stream
  subscriptions read and four routes that stop reading as never called.
- A call on a module of functions is followed from a method body, not only from
  a function's, and a brace-less arrow body is walked for the calls in it.
- `dead` says when a channel with no consumer belongs to a service that serves
  event streams, rather than reporting a publisher whose consumers are browsers
  as having none.
- A method written as a field — `handle = () => {}` — is read as the method it
  is: calls to it are edges, its body is walked, its annotations are read — the
  annotation being what the hints tell you to write when an address cannot be
  read, which is exactly the case a field wrapper is — and a request or a query
  written inside it is recorded. A helper written as a brace-less arrow answers
  with the expression it is, which is where most of them are written. A wrapper
  written that way is followed to the caller that decided the address, like any
  other. A field assigned a function from elsewhere is still reported.
- `dead --kind fields` lists the fields something happens to — the ones a
  receiver's whitelisting pipe removes on arrival, read from that receiver's own
  validation — and counts the rest on one line. On the project this is developed
  against that is 1,445 rows become 63 and a number. Every row is still in
  `--format json`, with its direction and whether it is dropped.

### Changed

- A repository whose `type` names no reader but whose manifest declares one the
  tool can read is told which type to set, rather than that there is no reader.
- `flowatlas diff` and `flowatlas stats` count unresolved rows the way `build`
  and `doctor` now do, so the four agree on what the word means.
- `dead --format json` is at format version 2: a `fields` row carries
  `direction` and `dropped`.
- `doctor --format json` is at format version 2: `level` has three values, and
  `unresolved` carries `nothing` beside `info`. `rows` and `sites` no longer
  include the places where nothing joins.

## [0.2.0][] - 2026-09-15

`@flowatlas/cli` only. `@flowatlas/markers` is unchanged at 0.1.1.

Measured on the five-repository project this is developed against, with the
same configuration and the same commit of every repository read by both
versions: routes reported as never called went from 220 to 62, browser requests
matched to a route from 318 to 489, and edges crossing a repository boundary from
366 to 537. The routes 0.1.1 called unused were being called through wrappers it
could not read.

### Added

- Requests made through a wrapper are followed to where their address was
  decided: Angular pass-through clients, a `BaseService` whose resource a
  subclass decides, finite `Record` tables of paths, and `fetch` variants
  (`x ?? fetch`, `new Request`, a getter returning the URL). A trailing query
  string is read as a hole rather than stopping the read.
- Inline handler arrows in Hono, Telegraf and callback registries become
  function nodes, so a flow continues past the line that registered them.
- Four `doctor` checks about the gate in front of a route: `route-unguarded`
  (no guard or middleware in front of a route that reaches stored data),
  `route-shadowed` (a worker answers before the application whose guards would
  have run), `route-wildcard-only` (only a catch-all serves the request) and
  `whitelist-strip` (a field the receiver's whitelisting `ValidationPipe`
  removes on arrival).
- Configuration keys `doctor.publicRoutes`, `doctor.publicDecorators`,
  `doctor.nonGateWrappers` and `doctor.skipGuardDecorators`, documented in
  `docs/CLI.md`.
- More than one `@CallsService` annotation on a method.
- When a name given to `flowatlas flow` matches nothing, the suggestions include
  clicks in a template, not only routes.

### Changed

- A composite decorator that returns `applyDecorators(UseGuards(...))` is read
  one level, and a guard or pipe built with `new` keeps its constructor
  options.
- A request from a method nothing references is a contract warning rather than
  an error, because nothing proves it runs.
- An annotation's path is retried under the service's global prefix.

### Fixed

- Contract errors that were not disagreements: an object literal with a spread
  and extra properties, a literal returned rather than assigned, a union of
  shapes on either side, `| null` in a project without `strictNullChecks`,
  `@IsOptional` meeting null, and `Partial<T>`.
- The page `flowatlas visualise` writes declares its doctype and UTF-8 charset.
- `flowatlas diff` ends its summary line, so it no longer runs into the next
  prompt.

## [0.1.1][] - 2026-09-12

The first published version of both `@flowatlas/cli` and `@flowatlas/markers`.

[unreleased]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Panevschi-Ruslan/flowatlas/tree/v0.2.0
[0.1.1]: https://www.npmjs.com/package/@flowatlas/cli/v/0.1.1
