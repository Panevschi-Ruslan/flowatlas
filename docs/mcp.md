# The graph server

An agent sitting in one repository can only read that repository. flowatlas serves
the whole project's graph over the Model Context Protocol, so a session in the
frontend can answer a question about the service three repositories away without
opening it, and without reading its source.

Eighteen tools. Only one of them returns code.

---

## Set it up

```sh
npm install -g @flowatlas/cli

flowatlas init --dir .     # writes flowatlas.config.json, registers the server
flowatlas build            # read every repository and join them
```

`init` already wrote `.mcp.json` into each repository. If you used `link`, or
added a repository later, register them with:

```sh
flowatlas mcp --install            # every repository in the project
flowatlas mcp --install --dry-run  # say what would change and write nothing
flowatlas mcp --install --repo web # only this one
```

It merges rather than overwrites, so servers a repository already has survive.
What it writes is this, with the path pointing at wherever your configuration
lives:

```json
{
  "mcpServers": {
    "flowatlas": {
      "command": "flowatlas",
      "args": ["mcp", "--config", "/path/to/flowatlas.config.json"]
    }
  }
}
```

`command` is the bare `flowatlas` when one is on your path, and an absolute path
when none is, so it works whether or not the tool is installed globally. To run
it with no install at all, use `"command": "npx"` and
`"args": ["-y", "@flowatlas/cli", "mcp", "--config", "…"]`.

### Per client

**Claude Code** reads `.mcp.json` at the root of the repository you opened.
Nothing else to do; `claude mcp list` should show `flowatlas`.

**Cursor** reads `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for
every project. Same object as above.

**VS Code** reads `.vscode/mcp.json`, with the servers under `"servers"` rather
than `"mcpServers"`.

**Claude Desktop** reads `claude_desktop_config.json` from its own settings
folder, with the same `"mcpServers"` key. It has no notion of the repository you
are in, so the absolute `--config` path matters there.

**Anything else** that speaks MCP over stdio: run `flowatlas mcp --config <path>`
and let it talk on stdin and stdout.

---

## The tools

`detail` (0 to 3, how much of each row comes back) is taken by `list_entries`,
`find_symbol`, `search`, `get_flow`, `who_calls`, `impact`, `who_emits`,
`who_consumes`, `get_type`, `type_usage` and `what_changed`: 0 is ids only, 1 (the default)
adds `file:line`, service and kind, 2 adds what the reader knows about each
row, and 3 is answered at 2 and says so. Those tools, `check_contract`, `dead`
and `findings` take
`maxNodes`, the most rows an answer holds: 150 by default, 60 for `get_flow`,
which also stops at about `maxChars` characters (12,000). `start_here`, `cant_follow`,
`describe_for_prompt` and `get_source` take neither: they are bounded by their
own limits (`perService`; `top` and `samples`; `maxSteps` and `maxChars`;
`maxLines`). Answers are bounded and say when they were cut, rather than
filling a context window.

### Answers

Every answer is one compact JSON document, in the text content and again as
`structuredContent`, so a client reads whichever it prefers. `start_here`,
`list_entries`, `find_symbol`, `who_emits`, `who_consumes`, `get_type`,
`get_source`, `search`, `cant_follow`, `dead`, `findings` and `type_usage` declare an `outputSchema`, and a
client can check every answer against it; the tree tools follow once their
shape is settled. An answer that is an error (`{ "error": … }`) carries
`isError: true` and no `structuredContent`, every time, so a client shows a
failed call and an assistant never reads it as an empty result. Where a near
name exists the error names it: an unknown channel (`who_emits`,
`who_consumes`), symbol (`get_source`) or entry (`get_flow`) answers with up to
five `suggestions`, nearest first, and a `next` that asks again with each. A
name that means more than one thing is not an error: it answers `candidates`,
and `next` is the same tool once per candidate. Every tool is annotated
`readOnlyHint: true`, `openWorldHint: false` and `idempotentHint: true`: none
writes anything or reaches outside the project, so a client that asks before
running a tool that might can skip asking.

A list reads a page at a time. `list_entries`, `find_symbol`, `search`,
`who_emits`, `who_consumes`, `impact` (its `entries`), `what_changed` (every
list), `cant_follow` (its `causes`), `dead` (its `rows`), `findings` (one kind's
`rows`) and `type_usage` (every group at once) take `offset`, 0 by default. An answer
that was cut says `total`, `nextOffset` and `truncated: "n more; next page
offset k"`, and `next` starts with the same call from that offset:

```
list_entries({maxNodes: 2})          → total: 17, nextOffset: 2,
                                       next: ["list_entries({maxNodes: 2, offset: 2})", …]
list_entries({maxNodes: 2, offset: 2})
```

An offset past the end is an empty page that still says `total`. In `search`
one offset pages every kind, and the next call asks again only for the kinds
that had more; in `what_changed` it pages every list at once.

Each fact is said once. A tree names a repeated node as `{ id, ref: true }`,
and says `service` on its root and again only on the row that crosses into
another service.

### Ids, `next`, and where to begin

Every row any tool returns carries an `id`, and every other tool takes that id
as it is: an entry id goes to `get_flow`, a channel id to `who_emits` and
`who_consumes`, a symbol id to `who_calls`, `impact` and `get_source`, a type id
to `get_type`. Every answer ends with `next`, at most four calls written out
with the ids it just returned, so an assistant never re-types or guesses a
name:

```
start_here → get_flow({entry: id}) → get_source({symbol: id})
who_emits / who_consumes({channel: id}) → get_flow on a handler
find_symbol → who_calls / impact({symbol: id}) → get_flow on an entry
get_type({type: id}) → type_usage({type: id}) → get_flow / check_contract on a use
findings() → findings({kind}) → the call each row names
dead({id}) → get_source on the call that could reach it
search({query}) → whichever of the above its row's id goes to
cant_follow → get_source on a place it names
```

The server's instructions describe the same chains. `list_entries`,
`find_symbol`, `search`, `who_calls`, `impact`, `who_emits`, `who_consumes`,
`start_here`, `what_changed`, `cant_follow`, `dead`, `findings` and `type_usage`
all take the same optional `service` filter.

| Tool | Answers | Takes |
|---|---|---|
| `start_here` | nodes, entries by kind and open gaps per service, the unresolved rows counted by kind (`counts`), the five most common gap reasons with an example, channels with one end missing, and a few entry ids to start from | `service`, `perService` |
| `describe_for_prompt` | one entry, channel, symbol or gap as Markdown to hand on: what is in front of it, what it can fail with, the steps in call order with repo-relative `file:line` and their marks, shapes in and out, gaps with their reasons, and the calls to make next with their ids; or, with `scope`, a whole class, file or service. No source code; bounded by `maxSteps`, at most 12 failure lines (one per status and exception), 10 gaps, 4 consumers of a channel, 40 methods or nodes of a class or file, and `maxChars` | `id` (required: any id, a gap id, a channel name or a route said aloud; a service name or `service#path` for those scopes), `scope`, `maxSteps`, `maxChars` |

`describe_for_prompt` and the page's *Copy as prompt* write the same text
(P97): each gathers one subject - the server from the database, the page from
its packed model - and core's `renderPrompt` writes it. The headings are the
same for every subject:

- `# Way in: …`, `# Channel: …`, `# Check: …` (a gap id) or `# Symbol: …`, then
  the id line (`` `id` — type / kind in service at `file:line` ``) and, for a
  way in, its schedule and the hits seen at run time.
- *In front of it* (the checks and opt-outs, P76) and *Can fail with* with the
  statuses in the heading, one line per status and exception with how many
  places raise it (P87).
- For a channel, *Published by · n* and *Consumed by · n*, each consumer with
  the steps under it; for a check, *Where · n*, every row of the gap id at its
  line with the node it is on; for a symbol or a check, *Reached from*, the
  ways in that reach it.
- **Steps**: the walk `get_flow` takes, in call order, each step with how it
  was reached and how sure the join is, what it takes and returns, and its
  marks in brackets - `best guess`, `on failure`, `side by side`, `per item
  (for-of)`, `likely N+1`, `throws 409 ConflictException`, `seen ×n` - and the
  lines it logs under it. A step written out already says under which id.
- **Shapes**, **Gaps** (in chain order, a loop reached from more ways in first)
  and **Ask next**: the calls that take the ids above, as `next` lists them.

`scope` writes more than one node (P95): `node` (the default) and `method` are
the node itself; `class` is the class, or the class a method belongs to;
`file` the file a node is in (or `service#path`); `service` the service a node
is in (or a service name). A scope the node does not have is an `isError`
answer naming the ones it does (`scopes`), with a `next` per scope.

- `# Class: …`: *Reached from* (the ways in that reach any method), then
  *Methods · n*, each method with the ways in that reach it and its own chain
  under it, the chains sharing `maxSteps` in order, a method whose chain was
  cut saying how many steps and the call that writes the rest; the gaps of
  every chain once.
- `# File: …`: *Reached from* (the ways in that reach any node of the file),
  *In this file · n*, every node of the file under the class it belongs to and
  by line (a method under its class, a route under its handler's, anything
  else under its first caller's), and the gaps recorded in the file.
- `# Service: …`: *Ways in · n* by kind, *Calls into other services* and
  *Called from other services* (the crossings `check_contract` lists between
  two services, by the other service), *Channels* it publishes and consumes,
  *Findings · n* by kind with the top three of each as `findings` ranks them,
  and its most common gaps. No *Steps*.

The page gathers a class and a file the same way (`subjectOf` in its
`steps.js` takes them as targets, and the parity test compares both sides on
every class and file of every built fixture); no control on the page asks for
them yet, and the page's side of a service is P134.

`describeForPrompt` and `PROMPT_LIMITS` are still exported from
`@flowatlas/mcp`; they are core's `renderPrompt` and limits.

Every unresolved row is a **gap** (the reading could not follow something), a
**note** (how a join or a reading was made; nothing was missed) or a
**finding** (something about the code: a likely N+1, a route with no guard).
`start_here`'s `counts` holds the figures `flowatlas build` ends on, from the
same function, so one database says one set of numbers everywhere:

| Name | Counts |
|---|---|
| `gaps` | gap rows that say something was not read: the build line's `missed` |
| `sites` | the places those rows stand for, folding included |
| `notes` | rows saying how a join or a reading was made |
| `findings` | rows saying something about the code itself |
| `nothing` | places with no edge to draw |

`topGaps` and each service's `gaps` are the actionable gaps: places the reading
could not follow, and nothing else. `topFindings` lists the findings beside them
the same way (reason, count, services, a first place): what the reading found
about the code, a likely N+1 or a route with no guard, whatever level the row is
written at. Notes are counted above and listed in neither. Every row is also
listed under `search({kinds: ["gaps"]})`, each hit with its `kind`.

A gap hit's `id` is the method or function its first place is written in, when
the graph draws one, so `next` is `get_source` and `who_calls` on it; its
`gapId` (`gap:<service>|<file>|<reason>`) is the one `flowatlas accept` takes.
One hit stands for every row of its reason in its file: `sites` counts the
places and `places` lists them as `file:line`, at most ten. A hit the graph
draws nothing around has no `id`, and `next` searches the gaps of its file.

A `query-in-loop` hit is one loop that runs a query, request or publish once per
item (P89). It carries `severity` (`likely`, a finding, or `note`, a loop that is
per item on purpose: a conditional write, a send to one recipient) and `waysIn`,
how many ways in of its service reach it; the loop hits are ranked by `waysIn`,
most first, a finding before a note reached alike (one hit per file and reason,
so a file holding both keeps its finding: P130), and `describe_for_prompt` writes each loop on the chain with
`Reached from N ways in.` in the same order. Loops bounded on purpose (chunks,
pages, cursors, retries, literal lists, batch calls, migrations) are not rows;
`flowatlas stats` counts them.

### Is it dead, and what to look at

| Tool | Answers | Takes |
|---|---|---|
| `dead` | whether one node is dead, with what could make that wrong; or, without `id`, every row `flowatlas dead` lists, verdict first | `id`, or `service` and `kind` (`entries`, `channels`, `providers`, `methods`), `offset` |
| `findings` | every finding counted by kind with the top three of each; with `kind`, one kind ranked by reach | `kind` (`n-plus-one`, `unguarded`, `contract-break`, `one-ended-channel`, or a finding's reason), `service`, `offset` |

`dead` reads the same functions `flowatlas dead` does (the linker's), so the
two cannot disagree; a test compares them on three fixtures. A **verdict** is
`dead` (nothing in the graph reaches it and nothing that could is unread),
`likely-dead` (nothing reaches it, and a call read in part could), `unknown`
(the graph's silence says nothing: it is triggered from outside the project,
or a call one segment off names it) or `alive`. Its **evidence**:

- `couldHit`: requests whose address was read in part and could reach the
  route (`{ call, path, loc }`, the link report's near misses);
- `oneOff`: requests that found no route and differ from this one by one
  segment (`{ call, asks, differs, loc }`, `differs` like `cancel for archive`
  or `:param left out`);
- `outside`: why the callers are out of sight - the entry kind (`cron`,
  `invoke`, a bot command), the infrastructure role (`probe`, `webhook`,
  `callback`, `discovery`, `configured`), `stream`, `declared`, `exported` or
  `library`;
- `callers` and `caller` for `alive`; `missing` (`consumer`, `producer`,
  `both`) for a channel; `unresolvedInjects` for a class in a service whose
  injects did not all resolve (`likely-dead`); `classReached` for a method
  nothing calls on a class that is used (`likely-dead`); `via` for a handler
  or controller judged by the way in or route that decided it.

`dead({id})` takes a way in, a channel (by its bare name too), a class, a
method or a function, by any name the other tools take; a controller is as
alive as its liveliest route. Without `id` it lists entries, channels and
classes (methods only with `kind: "methods"`), dead first, counted under
`counts`; `excludedEntryKinds` names the kinds never listed.

`findings` gathers the rows the graph classes a finding (P81) that nobody
accepted, the channels with one end, and the contract errors and warnings the
last `flowatlas contracts` wrote beside the database. Each row is `{ kind, id,
to?, method?, service, loc, message, severity?, rank, reach, next }`: `id` the
node it is about (the loop's method, the route, the sending side, the
channel), `next` the call that shows it (`get_source` at the loop's line,
`get_flow`, `check_contract`, `who_emits` / `who_consumes`). Ranked by reach
(D3): an N+1 by the ways in that reach its loop, an unguarded route by the
writes it reaches, then the reads, a contract break by severity and then the
ways in that reach its sender, a one-ended channel by the ends it has; `rank`
is its place in its kind across the project, and `reach` the numbers it was
ranked by. The per-item loops are counted under `notes`, and the findings
accepted with `flowatlas accept` under `accepted`.

### Finding your way in

| Tool | Answers | Takes |
|---|---|---|
| `list_entries` | every way into the project: routes, procedures, bot commands and buttons, scheduled jobs, message handlers | `service`, `kind`, `pathPrefix`, `offset` |
| `find_symbol` | fuzzy search over every node, by substring or camel-case initials | `query` (required), `types`, `service`, `offset` |
| `search` | one query over routes and other ways in, channels, tables, types, gaps, what ways in can fail with, and classes, grouped by kind, with `counts` of each | `query` (required), `kinds`, `limit`, `service`, `offset` |

`kind` is one of `http`, `rpc`, `event`, `cron`, `workflow`, `bot_command`,
`bot_callback`, `bot_event` and `scene_step`. A `workflow` is a state machine,
reached by the name it is deployed under; its steps are `function` nodes of
kind `state`. `rpc` is a procedure — a tRPC one, say — whose
address is the dotted path its callers write, `orders.list`, rather than a verb
and a path. It has no path for `pathPrefix` to match, so a prefix leaves
procedures out; narrow them with `service` and `kind` instead.

`find_symbol` accepts initials: `osc` finds `OrdersService.create`. Start here
when you know roughly what something is called.

`search` is the wider net. `kinds` is any of `routes`, `channels`, `tables`,
`types`, `gaps`, `fails` and `classes`. A gap's id, `gap:<service>|<file>|<reason>`,
is what `flowatlas accept` takes, every hit carries its `kind` (`gap`, `note` or
`finding`), new gaps come first, and an accepted one says
`accepted: true` with its note, and `acceptedBy` when a rule took it; an
`accepted.json` that cannot be read marks nothing accepted and says so in
`note`. Under
`fails`, an exception name or a status (`NotFoundException`, `404`) lists the
ways in that can fail with it, one hit per route with the id `get_flow` takes:
the first answer that matched (`exception`, `status`, `assumed` when nothing
on the path writes that status, `sites`), and `more` when others on the same
route matched too. A helper's choices count: `423` finds the routes whose
`toHttpError` can choose a 423.

### Following a chain

| Tool | Answers | Takes |
|---|---|---|
| `get_flow` | one entry followed through every repository it reaches, in call order, with the guard chain | `entry` (required), `depth`, `maxChars` |
| `who_calls` | everything that reaches a symbol, backwards across repositories | `symbol` (required), `depth` |
| `impact` | every entry point that can reach a symbol, and which services they belong to | `symbol` (required), `offset` |

Asked about a class, `who_calls` and `impact` answer for every method of it
something calls (P95): calls point at methods, never at the class. Each
`who_calls` caller says the method it calls under `calls`; `impact` says how
many methods it answered for under `forMethods`.

`entry` can be named the way you would say it aloud. All three of these mean the
same route:

```
POST /orders/12345
POST /orders/:param
entry:orders:http:POST:/orders/:param
```

Two kinds of entry are best named by their id, which `list_entries` and
`find_symbol` return. A procedure is `entry:api:rpc:orders.list`. And a service
that creates more than one application puts the application in the id, because
an address is only an address within one application:
`entry:api@WorkerModule:http:GET:/health` beside
`entry:api@ApiModule:http:GET:/health`. A name that matches both comes back as
a choice rather than a guess.

A procedure's callers are requests like any other, joined to it by that dotted
path with a `hits` edge, so `who_calls` on a procedure reaches the code in
another repository that asks for it.

`who_calls`, `impact` and `get_source` take a `symbol` by the same names: an
id, an entry said aloud (`GET /orders/123`, `bot:x`, `invoke:x`, read exactly as
`get_flow` reads it), or a name that is the one best match. A route said with a
literal segment resolves as the router would: `GET /orders/latest` is the route
registered as `/orders/latest`, not `/orders/:param`, and the answer names the
routes that would also answer it under `alsoAnswers`. Two routes that spell the
address out alike, in two services, stay candidates.

`impact` is the one to ask before changing something: it answers "what would
have to be retested", including the services whose chains run into this one
without an entry point of their own. With no way in it says `entriesNone`
("nothing in the graph reaches this from a way in; the callers may be behind a
gap", or "nothing reaches this"), and `next` names a deeper `who_calls`, the
service's `cant_follow` and a gap search on the file. A walk that stopped at
its own limit (4,000 nodes) says so in `truncated`.

`who_calls` walks breadth first to `depth` (3; 16 at most) and counts what it
left: a cut tree says `truncated: "n more nodes past depth 3; raise depth"`,
`stoppedBy` (`depth`, `maxNodes`, the one that left out more first), and
`frontier`, the rows on the depth line with callers past it, to ask on from
when 16 is not enough. A caller the graph holds no node for is a `missing` row.
A row that is no way in and that nothing calls carries `topOfChain: true` and
`gapsInFile`, the gaps in its file that may be hiding its caller (the target
itself says so at the top of the answer); `next` then names `cant_follow` for
its service and a gap search on its file. That is a lead, not a verdict: the
code is dead, or it is called from behind one of those gaps.

`get_flow` writes each node once. Met again on another path - a repository
helper every method calls, a logger, a mapper - it is `{ "id": …, "ref": true,
"seenAt": … }`, `seenAt` the id of the row its subtree is written under; met on
its own path, a cycle, it is `{ "id": …, "ref": true }`. Its budget goes where
the answer usually is: the steps that leave the service (a request, a publish,
a hand-off to another way in) first, then a data store, the handler, a call
into a method that itself leaves the service, any other call, and plumbing (a
method more than five methods call) last. That decides which rows get room,
never where they are written: children stay in call order. So a request
through shared plumbing reaches the service it ends in within the defaults.

A cut answer names the limit that cut it and the advice that helps:

```
"truncated": "23 more nodes past maxNodes 60; raise maxNodes or ask get_flow on a child id",
"stoppedBy": ["maxNodes"],
"crossingsLeft": [{ "from": "producer:…", "to": "channel:order.created", "type": "emits", "service": "orders" }]
```

`stoppedBy` is one or more of `depth` (`≥n more nodes past depth 8; raise
depth`), `maxNodes` and `maxChars` (`n more nodes past about 12000 characters;
raise maxChars or …`), the one that left out more first; the sentence is about
that one. `crossingsLeft` (at most eight, out of the service before a store)
are the crossings the walk reached and did not follow, ready to ask `get_flow`
or `check_contract` about. `next` holds `check_contract` for the first HTTP
crossing the tree reached and `get_flow` on the first crossing left, before
`impact`.

What `get_flow` says beside the chain:

- **`fails`** on each entry: what it can end in, one entry per status and
  exception - `{ status?, exception, assumed?, declared?, sources, sites, at,
  loc? }`, with `at` and `loc` the first place it is raised and `sources` how
  (`throw`, `guard`, `pipe`). `assumed: true` is a status nothing on the path
  writes, such as the framework's 500 for an error it does not know;
  `declared` is the status the error class states where no filter maps it. At
  `detail >= 2` each entry adds `places: [{ at, loc, source }]`. A throw whose
  exception a helper chooses at run time (`throw toHttpError(check)`) is named
  after the helper and adds `via: 'helper'` and `chosenFrom: [{ exception,
  status?, assumed? }]`, what the helper's table can give; `status` is there
  only when every choice agrees, and `family: 'auth'` marks a helper whose
  answer could not be read that refuses a check of who is asking.
  `describe_for_prompt` writes it as `toHttpError (401 | 403 | 423)` with the
  classes it is chosen from. Read for NestJS.
- **Guards** in front of a NestJS route carry `where` (`global`, `module`,
  `controller`, `route`), `via` (`APP_GUARD in AuthModule.forRoot`), and
  `skippedBy` when an opt-out decorator switches one off; the entry carries
  `optOuts`.
- **`observed: n`** on a row real traffic went through, after
  `flowatlas observe` has read a trace file: the count on the join into it, or
  the entry's hits. Absent when nothing saw it.
- **`seenAmbiguous: n`** on a row that requests could have been, or whose
  join into it they could have run, but fit other places as well: those are
  counted on none of them, so `observed` never spreads one request over
  guesses.
- **`baseUrlFrom`** and **`baseUrl`** on a request joined by a value read from a
  repository's own files, the code's own fallback or the setting's name, saying
  where the value came from.

`who_calls` rows carry `observed: n` and `seenAmbiguous: n` the same way.

### Messages and types

| Tool | Answers | Takes |
|---|---|---|
| `who_emits` | everything that publishes on a channel, across every repository | `channel` (required), `offset` |
| `who_consumes` | everything that handles messages from it; empty means nothing does | `channel` (required), `offset` |
| `get_type` | the structure of a type, with what it refers to expanded to a depth | `type` (required), `depth` |
| `type_usage` | every way in, crossing, channel and call that takes or returns a type, and the types holding it | `type` (required), `offset` |
| `check_contract` | what one side of a crossing sends against what the other expects | `edge`, or `from` and `to` |

`get_type` at `detail: 0` names the type and its fields (or its members); at 1
it says what each field is, where the type is declared, and names each type it
refers to with its fields' names under `nested`, keyed by id; at 2 it adds the
structural hash, `meta` and the whole declaration of each nested type.

`type_usage` takes what `get_type` takes (an id, or a name; a name two types
have answers `candidates`) and lists every edge whose `params` or `returns`
names the type, grouped: `taking` and `returning` (ways in whose handler takes
or returns it: `{ id, handler }`), `crossings` (`http_calls`, `hits`),
`channels` (`emits`, `consumes`) and `calls` inside a service (`{ from, to,
type, carries }`, `carries` being `params` or `returns`), with `counts` per
group, and `nested`: the types that hold it one level out, a field of it or a
type argument, so a change to a nested type shows the outer ones. A type no
edge names answers with `nested` and a note: it is used inside one function at
most. `get_type`'s `next` names `type_usage` first.

`check_contract` identifies a crossing either by its two ends or by one string:
`"from -http_calls-> to"`. Its `findings`, when the contracts checker is
installed (`flowatlas mcp` installs it), are `{ severity, kind, direction,
field, expected, actual, message, ignored? }`; the crossing is the answer's
`edge`.

Given two service names as `from` and `to` (and no node by either name, which
would win), it lists every crossing from one into the other: each request
(`http_calls`, `hits`) that reaches an entry of the other, and each publish
(`emits`) onto a channel the other handles (`via` names the channel). Each
crossing is `{ from, to, type, via?, status, check }`, worst `status` first,
`check` the call that checks it in full; `byStatus` counts them and `maxNodes`
bounds the list. With none it says so, and how many go the other way.

### Why a flow stops

| Tool | Answers | Takes |
|---|---|---|
| `cant_follow` | every step the reading could not follow, grouped by cause and then by the package it points into, with a few places each and the id of the method each is written in | `service`, `cause`, `package`, `top`, `samples`, `offset` |

The same breakdown `flowatlas doctor --unresolved` prints. A cause is what the
code says about why: `module-not-installed` (with the package), `import-unresolved`
(a path or alias that resolves to no file), `re-export-missing`, `any-typed`,
`language-any`, `callback-param`, `untyped-parameter`, `dynamic-member`,
`interface-type`, `function-field`, and so on; a row with no finer answer counts
under its own reason. Rows are demoted where an annotation already answers
them and gaps accepted with `flowatlas accept` are left out and counted apart,
exactly as `doctor --unresolved` does, a route rule included; an `accepted.json`
that cannot be read leaves nothing out and says so in `note`. Only gaps are
here: notes and findings are not steps the reading missed, so they are counted
apart under `apart: { notes, findings }` and listed by `search`. A `cause` that
answers no causes says why in `note`: its rows are findings or notes
(`"route-unguarded is a finding, not a step the reader missed: 4 rows"`, with
`next` the search that lists them), or were all accepted, or there are none in
that service or package. A cause nothing knows is an error with `known`, the
causes of this graph and of the catalogue, and the `nearest` few by spelling. A place is
`{ loc, id?, symbol?, service? }`: `symbol` where it is not the id (the text of
a call, say), `service` where the cause spans more than one. `total.causes`
counts every cause, and `offset` pages them. `next` offers `get_source` on the
first place and the calls that narrow to its cause and its package.

Under `module-not-installed`, a package the configuration as it stands would
read in its place once rebuilt (P78) - its source in a repository read here, or a
listed shape file - carries `coveredBy: "repo" | "shape"` and `coveredFrom`,
which hold for every place under it; `next` then says to rebuild. One nothing would read
in its place gets `run: flowatlas shapes --suggest --package <name>` in `next`,
the command that lists the names the project uses of it. A step drawn through
types such a stand-in supplied says so on its edge in `get_flow`: `because:
["package-from-repo"]` or `["shape-file"]`, and `typedBy` naming the package.

### What a branch changed

| Tool | Answers | Takes |
|---|---|---|
| `what_changed` | the last `flowatlas diff`, read back: nodes, edges and types added, removed or changed, the ways in that reach them, and the contracts the branch broke; with `verdict`, whether it is safe to merge and why | `service`, `verdict`, `offset` |

It reads the `diff.json` that `flowatlas diff <base-ref>` writes rather than
building two revisions inside a tool call; run the command to refresh it. At
`detail: 0` a changed node is its id and a way in its id, type and the changed
node it `reaches`; at 1 they add service and label (and a way in its kind and
confidence); at 2 a changed node adds the `fields` that changed.

`base` and `head` are `{ ref, label }`: `label` is `working tree` where no ref
was read, and otherwise the ref with the commit each service was read at
(`main (billing 392089da, orders 08ad86ef; gateway from the working tree)`).
`counts` are the lengths of the lists below before `maxNodes` cut them, so a
count beside a shorter list shows the cut; under `service` every count is that
service's (types by the service in their id), and a service the diff does not
name answers zeros and `note: "no such service in the diff"`. `counts.gaps`
and `counts.lostJoins` count the gap ids the branch added and removed and the
calls that stopped joining, and `counts.flows` the ways in whose flow changed.

**What a flow does now.** A way in under `entries` (or `retest`) whose flow the
branch changed carries `flow`: `{ side, added, removed, changed, steps }`, the
step counts of its flow compared on both graphs (`side` `head` for a way in
only the head has), and from `detail` 1 the changed steps as text, in call
order - `+ orders → billing POST /invoices`, `- gateway → orders GET
/shipments/:param`, `~ gateway → orders POST /orders (body: +channel
(required))`, `+ gateway stops here: target-route-not-found` - at most 12 of
them and a line counting the rest. The same steps `flowatlas diff` draws as a
sequence diagram; an agent gets the text, never the diagram. A `diff.json` of
format 2 has no flows, and says nothing less about the verdict.

**The verdict.** `what_changed({verdict: true})` adds `verdict` - `safe`,
`unsafe` or `unknown` - and `because`, one sentence per reason, unsafe ones
first. The rule is fixed, so a reviewer can disagree with a reason rather than
with a score:

- **unsafe**: a new contract error; a call whose target went (it joined a
  route on the base side and joins nothing now), or a channel left with no
  producer or no consumer; a removed way in that another service still calls.
- **unknown**: a service the base ref could not be read for (read from its
  working tree on both sides, so reported unchanged without being compared); a
  new gap on a path from a changed node back to a way in, which the reading
  cannot see past; a `diff.json` of format 1, which holds no gap rows ("rerun
  flowatlas diff for new gaps"). A format-2 file, which holds no flows, is read
  as it is: the verdict does not read flows.
- **safe** otherwise.

Beside it: `newGaps` (gap ids the head has and the base does not, each with
the method it is in, `onChangedPath: true` where it makes the verdict
unknown, and `next`), `vanishedTargets` (`{ caller, target, now }`, `now` what
the head side says instead, such as `target-route-not-found`), `retest` (the
ways in that reach a change, ranked by how many changed nodes each reaches and
then by `observed` traffic; it takes the place of `entries`) and `newFindings`
(likely N+1s, unguarded routes and contract warnings the branch introduced,
which never decide the verdict). One `offset` pages these with the rest.
`next` traces the first way in to retest, checks the first break, reads the
method of the first new gap and asks who calls the first caller that lost its
target.

### Prompts and resources

Three prompts write out the calls a common review takes, with the ids already
resolved. They are text that names calls - the client runs them - and each
call is written by the same functions `next` writes with.

| Prompt | Arguments | Writes |
|---|---|---|
| `before-rename` | `symbol` | `who_calls` and `impact` on it (`type_usage` for a type), `check_contract` on each crossing it is on, and what else must be renamed with it |
| `pr-review` | `base?` | `what_changed({verdict: true})` and how to follow its `next`; or, when `diff.json` is missing, older than the database or of another base, the `flowatlas diff` to run first |
| `trace-route` | `route` | `get_flow` on it, `check_contract` on each crossing of the walk, `cant_follow` for the services where it stops, `describe_for_prompt` to hand it on |

A name that answers to several things is listed with each candidate's id, and
the prompt asks which.

| Resource | Holds |
|---|---|
| `flowatlas://reasons` | every reason a row of the reading can give: its kind (gap, note, finding), the cause it is counted under, and the sentence `doctor` heads it with |
| `flowatlas://services` | the services the graph holds, each with its resource |
| `flowatlas://services/{name}` | one service: what `start_here` says of it, its crossings to and from every other service with how each checks, and its top findings |

Resources read the same database as the tools: without one, a service reads as
the same `graph.db not found … run flowatlas build` the tools answer.

### Source

| Tool | Answers | Takes |
|---|---|---|
| `get_source` | the code of one symbol, by id or by name | `symbol` (required), `context`, `fromLine`, `maxLines` |

At most `maxLines` lines (400, the most there is) per answer. A declaration
longer than that says `truncated: "declaration continues past line N; ask with
fromLine N+1"`, and `next` starts with that call; `context` widens only the
first and the last page. The only tool that returns source, deliberately. A trace never drags in the body
of every method along it: the agent asks the graph which name to look at, then
asks for that one name.

---

## Using it well

The shape that works is **narrow, then read**:

1. `find_symbol` or `list_entries` to get the exact id.
2. `get_flow`, `who_calls` or `impact` to see what it connects to.
3. `get_source` on the one or two names that turned out to matter.

Going straight to `get_source` on a guess costs a lot of context and usually
answers the wrong question. The graph is cheap; source is not.

Some prompts that work as they are:

- *"Use flowatlas: what breaks if I change the shape of the order response?"*
- *"Use flowatlas impact on OrdersService.cancel before you edit it."*
- *"Which service publishes order.created, and does anything handle it?"*
- *"Follow POST /orders and tell me every settings key it needs."*
- *"What can POST /orders fail with, and which guard is in front of it?"*
- *"Why does the flow from GET /reports stop? Use cant_follow."*
- *"Is this branch safe to merge? Use the pr-review prompt."*

---

## Keeping it current

The server reads the database that `build` writes, and reopens it whenever its
timestamp changes. So a rebuild is picked up without restarting anything:

```sh
flowatlas build            # after pulling, or after your own change
flowatlas build --watch    # rebuild on every save, project held open
```

A rebuild with nothing moved reads only what changed, so it is a fraction of a
cold build; the [README](../README.md#measured-on-the-demo-project) has both
timed on the demo project.

---

## When something is wrong

**The client does not list `flowatlas`.** Check that `.mcp.json` is at the root of
the repository you actually opened, and that `flowatlas --version` runs in the
same shell the client starts from.

**It lists the server but every call fails.** The graph has not been built, or
`--config` points at a configuration whose `output` directory is empty. Run
`flowatlas build` and check that `.flowatlas/graph.db` exists.

**A tool answers, but with nothing in it.** That is an answer: nothing reaches
the symbol you named, or nothing handles the channel. `flowatlas doctor` says what
could not be read and why, which is usually the next thing to look at.

**A whole service answers nothing.** Run `flowatlas doctor`. If it exits 2, the
graph is one nobody could report on — the last build failed, a service
contributed no node, or most of a service's ways in were read no further than
their addresses — and it says which. Every tool will answer truthfully about
that graph, and the graph is not the project.

**An answer looks cut off.** It was, and it says so. A list says `nextOffset`:
ask again with `offset` for the next page (`next` writes the call). A tree
(`get_flow`, `who_calls`) does not page: it says which limit stopped it
(`stoppedBy`), so raise that one, or ask `get_flow` on a row it showed or on one
of its `crossingsLeft`, or `who_calls` on an id in its `frontier`.

**An answer is empty.** It says why. `impact` with no way in says
`entriesNone`, a `who_calls` chain that ends in nobody says `topOfChain` and
`gapsInFile`, `cant_follow` for a cause with no gaps says what its rows are,
and an unknown name is an error with `suggestions`.

---

The full command reference is [docs/CLI.md](CLI.md). The walkthrough, with a
recording of the server answering, is
[docs/getting-started.md](getting-started.md).
