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
or which-one-did-you-mean, `2` could not run at all.

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
configuration will go and asks which belong to the project.

| Flag | Default | Does |
|---|---|---|
| `--dir <path>` | the parent of the output | where to look for repositories |
| `--out <file>` | `./flowatlas.config.json` | where to write the configuration |
| `-y, --yes` | off | accept every suggestion without asking. Required when the terminal is not interactive |
| `--force` | off | overwrite an existing configuration |
| `--no-mcp` | off | skip registering the graph server |

The type of a repository is read from its manifest: `@nestjs/core` makes it
`nestjs`, `@angular/core` makes it `angular`, `next` makes it `nextjs`, `react`
makes it `react`, `express`, `fastify` and `koa` make it each of those, and
anything else is written as `unknown`. Where the manifest names a framework there
is no reader for — Nuxt, Remix, Vue or Svelte — `init` says so by name, and
`build` repeats it on that repository's line:

```
web            skipped (no-extractor: Next.js, no reader yet)
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

For `express`, `fastify` and `koa` what is read is the route as the code
registers it — the verb, the path, the handler, the router it is declared on and
the prefix that router is mounted under, however many mounts deep — together
with the middleware in front of it, including middleware installed on an
application above the mount and inherited through it. That is what makes the
route audit answer on these repositories rather than defer to a person. A path
assembled at run time is reported rather than placed at a guessed address, and a
file-system router — `@fastify/autoload` as much as Next.js — is refused, since
the address lives in a directory name rather than in the call.

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
| `--json` | off | print the report as JSON instead of a summary |

A hash is recorded per source file, so a second build of unchanged sources reads
nothing and still writes every output. Under `--watch` each repository's parsed
program is held open, which is where most of the saving comes from.

Exit code is `2` when a repository could not be read; the others are still built
and joined.

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
| `--out <file>` | `graph.html` | where to write it |
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
| `repo` | string | required | path to the repository, relative to this file or absolute |
| `type` | string | required | which extractor reads it: `nestjs`, `angular`, `express`, `fastify`, `koa`, `hono`, or anything else to skip it |
| `baseUrlEnv` | string[] | `[]` | settings keys other services use to address this one |
| `apiBaseEnv` | string[] | found in the environment files | for a browser: which of its settings keys hold an address, when they are not found |
| `apiTarget` | object | `{}` | for a browser: which service each of those keys points at, as `{ "apiUrl": "admin-api" }` |
| `openapi` | string | none | an OpenAPI document that *declares* this service, for an end nothing here can read; path relative to this file |
| `tsconfig` | string | found in the repository | which TypeScript configuration to parse with |
| `bootstrap` | string | `src/main.ts` | the application entry file, when it is elsewhere |

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

**`openapi` is for the ends of a project nobody here can read.** A payment
provider, another team's service, something written in another language: there
is no repository to open and no extractor to choose, so the document is read
instead and its routes and shapes land in the graph exactly as a repository's
would. `repo` still says where the document lives; `type` is ignored, since no
extractor runs.

```json
{ "name": "billing", "repo": "./contracts", "type": "declared", "openapi": "contracts/billing.json" }
```

Every node, every edge and every join into a declared service carries
`declared` confidence rather than `static`, because a declaration is somebody's
word for itself and an edge may not claim more than the weakest of its two ends.
`declared` is its own level, below `marker`: an annotation is written by
somebody who can see the code, a document by somebody who cannot see yours.
Nothing here can check a document against the running service, so `doctor`
reports how recently the document changed — against the newest commit among the
repositories that *were* read — under `openapi-document-age`. That age is
worked out when `doctor` runs rather than recorded when the graph is built,
because it is a question about today. `fixtures/multi-repo-declared` is the
worked example.

### Top level

| Key | Type | Default | Means |
|---|---|---|---|
| `sharedPackages` | string[] | `[]` | packages whose types are one declaration rather than two copies |
| `output` | string | `.flowatlas` | where the three build outputs go |
| `types.maxDepth` | number | `3` | how deep an anonymous shape is written out before it becomes a reference |
| `contracts.depth` | number | `3` | how far into nested shapes `flowatlas contracts` compares |
| `contracts.rules.disable` | string[] | `[]` | rules about the JSON wire this project's wire does not follow |
| `contracts.ignoreEdges` | string[] | `[]` | boundaries whose drift is deliberate, as `from\|type\|to`, for code you cannot annotate |
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

`contracts.json` is at format version 3: a party may carry `writes`, a finding
may carry `impact`, a request-direction message distinguishes what a call sends
from what its type permits, and an `impact` may read `unread` as well as the
three words version 2 knew.

### `adapters`

| Key | Type | Default | Means |
|---|---|---|---|
| `auto` | boolean | `true` | detect which adapters apply from each repository's manifest |
| `force` | object | `{}` | use these adapters regardless of what was detected |
| `db.localBaseClasses` | string[] | `[]` | classes of your own that behave like a repository, so calls through them are data access |
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
code it would have read is in the graph: cal.com's `apps/web` depends on
`@calcom/trpc`, which is where `@trpc/server` is declared, and 171 of its 227
boundaries live in that package. Only what the service reaches is taken in — a
workspace has hundreds of members and a service declares a dozen, and folding in
the rest would make every service look like every framework anybody in the
repository uses.

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

A `consumers` entry may be a bare decorator name, which means what it always
meant: the channel is that decorator's first argument. Written out it takes
`decorator`, an optional `classDecorator` for a worker class that states its
channel above the class rather than on each method, `channel`, and `kind`.

A name no locator can read produces a publisher or a handler with no channel and
a row saying which call to look at. It never produces a channel node: a guessed
name would silently join two services that never speak.

**`consumers` and `subscribers` are the two ways a bus says who listens.** A bus
with a decorator per handler is described by `consumers`; one where receiving is
a call is described by `subscribers`. Without either, its channels are read as
all publishers and no handlers, which reads as though nothing anywhere listens.
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
nothing was read from looks exactly like a repository with nothing in it. Three
rows say which part matched nothing: `entry-http-description-inactive` when none
of the description's `packages` is a dependency here (ordinary in a project of
several repositories, and `info`), `entry-http-types-unmatched` when nothing in
the repository is a value of any type it names, and `entry-http-routes-unmatched`
when calls on those types were found and none of them spelled a verb and a path.

The same two rows are written for a framework shipped with the tool, at `info`
rather than as something to act on. A repository that depends on Express and
declares no route on it is ordinary — a library, a worker, a service whose routes
live elsewhere — and it reads exactly like a repository whose routes are declared
in a way no reader here knows, which is what Medusa v2's file-system router is.
The reader cannot tell those two apart; what it can do is say which two it cannot
tell apart, rather than counting the repository as clean (R84).

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
between the path and the handler are recorded on the entry and are not mistaken
for it. Where the same address is declared on both sides, it is one entry point
with two handlers, and `flowatlas build` lists it under `routes.duplicated`:
which of the two answers depends on how they are wired together, and that
cannot be read from either.

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
