# Changelog

All notable changes to the published packages. `@flowatlas/cli` and
`@flowatlas/markers` are versioned separately; an entry names the package when
only one of them moved.

## [Unreleased][unreleased]

Three ways the data-layer reader was dishonest, two of them found by work on
other things.

### Fixed

- A query written in a module-level function is read. The leaf walk read the
  methods of the indexed classes and nothing else, so a `pool.query(…)` or a
  `db.select(…)` in a module of exported functions — the shape most TypeScript
  that is not Nest is written in — produced no node, no unresolved row and no
  report: nothing at all. Functions declared at the top of a module, arrows
  assigned to a const, functions nested in either, and handlers written in the
  registration are now read exactly as methods are, and a body is read whether
  or not anything calls it.
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

### Added

- `fixtures/fn-data-layer`, the same four queries written twice — as a module of
  exported functions and as a class — so that the two can be compared rather
  than described, and both spellings of an entity name are covered.

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

[unreleased]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Panevschi-Ruslan/flowatlas/tree/v0.2.0
[0.1.1]: https://www.npmjs.com/package/@flowatlas/cli/v/0.1.1
