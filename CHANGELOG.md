# Changelog

All notable changes to the published packages. `@flowatlas/cli` and
`@flowatlas/markers` are versioned separately; an entry names the package when
only one of them moved.

## [Unreleased][unreleased]

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

[unreleased]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Panevschi-Ruslan/flowatlas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Panevschi-Ruslan/flowatlas/tree/v0.2.0
[0.1.1]: https://www.npmjs.com/package/@flowatlas/cli/v/0.1.1
