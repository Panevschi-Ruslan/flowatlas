# The graph server

An agent sitting in one repository can only read that repository. flowatlas serves
the whole project's graph over the Model Context Protocol, so a session in the
frontend can answer a question about the service three repositories away without
opening it, and without reading its source.

Fifteen tools. Only one of them returns code.

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

Every tool takes `detail` (0 to 3, how much of each node comes back) and
`maxNodes` (the ceiling on the answer), except `get_source`, which takes
`context` and a line limit instead. Answers are bounded and say when they
were cut, rather than filling a context window.

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
search({query}) → whichever of the above its row's id goes to
cant_follow → get_source on a place it names
```

The server's instructions describe the same chains. `list_entries`,
`find_symbol`, `search`, `who_calls`, `impact`, `who_emits`, `who_consumes`,
`start_here`, `what_changed` and `cant_follow` all take the same optional
`service` filter.

| Tool | Answers | Takes |
|---|---|---|
| `start_here` | nodes, entries by kind and open gaps per service, the unresolved rows counted by kind (`counts`), the five most common gap reasons with an example, channels with one end missing, and a few entry ids to start from | `service`, `perService` |
| `describe_for_prompt` | one entry, channel or symbol as Markdown to hand on: what is in front of it, what it can fail with, the chain in call order with repo-relative `file:line`, shapes in and out, gaps with their reasons, and the ids to ask next. No source code; bounded by `maxSteps` and `maxChars` | `id` (required), `maxSteps`, `maxChars` |

`describe_for_prompt` is rendered by `describeForPrompt`, a pure function
exported from `@flowatlas/mcp`, so a page can copy the same text.

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

`topGaps` and each service's `gaps` are the actionable gaps; notes and findings
are counted above and listed under `search({kinds: ["gaps"]})`, each hit with its
`kind`.

### Finding your way in

| Tool | Answers | Takes |
|---|---|---|
| `list_entries` | every way into the project: routes, procedures, bot commands and buttons, scheduled jobs, message handlers | `service`, `kind`, `pathPrefix` |
| `find_symbol` | fuzzy search over every node, by substring or camel-case initials | `query` (required), `types`, `service` |
| `search` | one query over routes and other ways in, channels, tables, types, gaps, what ways in can fail with, and classes, grouped by kind | `query` (required), `kinds`, `limit`, `service` |

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
ways in that can fail with it, each with the id `get_flow` takes.

### Following a chain

| Tool | Answers | Takes |
|---|---|---|
| `get_flow` | one entry followed through every repository it reaches, in call order, with the guard chain | `entry` (required), `depth` |
| `who_calls` | everything that reaches a symbol, backwards across repositories | `symbol` (required), `depth` |
| `impact` | every entry point that can reach a symbol, and which services they belong to | `symbol` (required) |

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

`impact` is the one to ask before changing something: it answers "what would
have to be retested", including the services whose chains run into this one
without an entry point of their own.

What `get_flow` says beside the chain:

- **`fails`** on each entry: the exceptions it can end in, with the status the
  framework answers each with and where it is thrown (`source` is `throw`,
  `guard` or `pipe`). Read for NestJS.
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
| `who_emits` | everything that publishes on a channel, across every repository | `channel` (required) |
| `who_consumes` | everything that handles messages from it; empty means nothing does | `channel` (required) |
| `get_type` | the structure of a type, with what it refers to expanded to a depth | `type` (required), `depth` |
| `check_contract` | what one side of a crossing sends against what the other expects | `edge`, or `from` and `to` |

`check_contract` identifies a crossing either by its two ends or by one string:
`"from -http_calls-> to"`.

### Why a flow stops

| Tool | Answers | Takes |
|---|---|---|
| `cant_follow` | every step the reading could not follow, grouped by cause and then by the package it points into, with a few places each and the id of the method each is written in | `service`, `cause`, `package`, `top`, `samples` |

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
apart under `apart: { notes, findings }` and listed by `search`. `next` offers
`get_source` on the first place and the calls that narrow to its cause and its
package.

Under `module-not-installed`, a package the configuration as it stands would
read in its place once rebuilt (P78) - its source in a repository read here, or a
listed shape file - carries `coveredBy: "repo" | "shape"` and `coveredFrom`, and
so does each of its places; `next` then says to rebuild. One nothing would read
in its place gets `run: flowatlas shapes --suggest --package <name>` in `next`,
the command that lists the names the project uses of it. A step drawn through
types such a stand-in supplied says so on its edge in `get_flow`: `because:
["package-from-repo"]` or `["shape-file"]`, and `typedBy` naming the package.

### What a branch changed

| Tool | Answers | Takes |
|---|---|---|
| `what_changed` | the last `flowatlas diff`, read back: nodes, edges and types added, removed or changed, the ways in that reach them, and the contracts the branch broke | `service` |

It reads the `diff.json` that `flowatlas diff <base-ref>` writes rather than
building two revisions inside a tool call; run the command to refresh it.

### Source

| Tool | Answers | Takes |
|---|---|---|
| `get_source` | the code of one symbol | `symbol` (required), `context` |

The only tool that returns source, deliberately. A trace never drags in the body
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

**An answer looks cut off.** It was, and it says so. Raise `maxNodes`, or narrow
with `service` and `depth`.

---

The full command reference is [docs/CLI.md](CLI.md). The walkthrough, with a
recording of the server answering, is
[docs/getting-started.md](getting-started.md).
