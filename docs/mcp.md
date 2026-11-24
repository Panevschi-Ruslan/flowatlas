# The graph server

An agent sitting in one repository can only read that repository. flowatlas serves
the whole project's graph over the Model Context Protocol, so a session in the
frontend can answer a question about the service three repositories away without
opening it, and without reading its source.

Twenty-six tools, three prompts and three resources. Only one of the tools
returns code, and a session is offered only the tools its project can answer
([which tools appear when](#which-tools-appear-when)).

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

### The command

| Flag | Does |
|---|---|
| `--config <path>` | the configuration whose database to serve (default: found from the working directory) |
| `--db <path>` | a database to read directly, instead of the configured one |
| `--install` | write `.mcp.json` into every repository of the project, and serve nothing |
| `--repo <name>` | with `--install`, only this service |
| `--dry-run` | with `--install`, say what would change and write nothing |
| `--all-tools` | list every tool, not only those the project can answer, whatever the configuration's `mcp` block says |
| `--no-always-load` | list no tool to load upfront: Claude Code defers every tool, the core ones too (see [The core tools, loaded upfront](#the-core-tools-loaded-upfront)) |
| `--upfront <tools>` | only these core tools load upfront, comma-separated (`who_calls,impact,search,get_flow`); the rest load by ToolSearch (P392) |

The server answers `initialize` as `flowatlas`, with the version of the command
you installed as `serverInfo.version` (`flowatlas --version` prints the same).

### Tell the assistant when to ask

Registering the server tells an assistant it is there, and nothing about when
to choose it over a search. An assistant in the `web` checkout asked who calls
`GET /orders/:id` greps `web`, finds the browser's call, and answers from half
the project: the other callers are in checkouts it cannot see.

```sh
flowatlas agents install                   # the guide, in the files each assistant reads
flowatlas agents install --instructions    # and a marked block in AGENTS.md, CLAUDE.md, Copilot's file
flowatlas agents install --hook            # and the Claude Code search, edit and prompt hooks
flowatlas agents install --hook --no-prompt-cards   # the search and edit hooks only
flowatlas agents status
flowatlas agents remove                    # takes out what install wrote, and nothing else
```

The guide is one short page: the project's services, the questions the graph
answers better than a search with the tool and the command for each (who calls,
what breaks, follow a request, who handles a message, how A reaches B, is it
dead, why a flow stops, is a branch safe), and the rules from
[Using it well](#using-it-well). The server's instructions name the same
questions. Nothing in it changes with a build; counts and gaps come from
`start_here`.

A team's own file (`AGENTS.md`, `CLAUDE.md`, Copilot's) is read whole at the
start of every session and sent again on every turn, so its block is shorter
than the guide (P366): the services, the questions in a few words, and five
lines on spending few turns. It names no full guide to read (P382): the skill
loads itself when its description fits, and a line pointing at it invited a
Read, a turn of its own.

- before changing a route, handler, body type or message payload: `impact`
  first (P382), the one habit that saves a broken caller in a repository the
  agent never opened;

- in Claude Code the core tools are loaded already (P380, [below](#the-core-tools-loaded-upfront)):
  no ToolSearch call for them; any other tool loads in one ToolSearch call with
  every tool the question needs. Where the server leaves them deferred
  (`mcp.alwaysLoad: false` in the configuration, or the repository's
  `.mcp.json` entry saying `"alwaysLoad": false` or `--no-always-load`), the
  line is the one call that loads them, the `select:` line written out under
  the name the server is registered as there (`mcp__flowatlas__who_calls`, …);
- an answer that says `complete: true` is the whole answer: check only what it
  lists as unread or unsure, not its rows; keep its `reach: "maybe"` rows when
  asked what breaks: they sit behind an unread call (`gap`), not nowhere
  (P367);
- several in one call, under each tool's own key: who_calls and impact
  `symbols`, dead `ids`, find_symbol and search `queries`, get_type `types`;
  calls that do not need each other together;
- answers are compact: `verbose: true` gives every field.

Where Claude Code reads the server's instructions beside the block, they say
the questions, the call for each and the habits on every turn already, so the
block in `CLAUDE.md` of a repository whose `.mcp.json` registers the server is
the services and the habit for an edit, about 370 characters where the whole
block is about 1,050 (P382); with the core tools deferred it keeps the
ToolSearch line too. `AGENTS.md` and Copilot's file, read by assistants that
may never start the server, keep the whole block.

The guide (the skill and the Cursor rule, read when used) says the same with
the table and the other rules: one call per question, each tool taking the
name as the agent has it (an id, `Class.method`, a route said aloud) and
`service` picking among same-named ones; `start_here` only for a project the
agent does not know.

Found from the working directory, the project is the nearest configuration
above it. Run inside a git repository that is none of the project's (neither
its root, one of its repositories nor one holding them), `install`, `status`
and `remove` refuse, name the configuration found and write nothing; `--config`
names a project explicitly.

| Where | Read by | Written |
|---|---|---|
| `.claude/skills/flowatlas/SKILL.md` | Claude Code, loaded when its description fits the question | by default |
| `.cursor/rules/flowatlas.mdc` | Cursor, as a rule it applies when its description fits | by default |
| `AGENTS.md` | Codex, Cursor, Copilot's agent and others; Claude Code where there is no `CLAUDE.md` | `--instructions`, made where there is none |
| `CLAUDE.md` | Claude Code | `--instructions`, only where there is one |
| `.github/copilot-instructions.md` | Copilot | `--instructions`, only where there is one |

The first two are flowatlas's own files and are rewritten whole. One edited by
hand is kept and named (`edited by hand`), and a file of that name that is not
flowatlas's is left alone (`not flowatlas`); `--force` replaces either. In a
team's own file the guide is a marked block (`<!-- flowatlas:agents -->`), and
nothing outside it is touched. `init` prints the command; `init --agents`, with
`--instructions`, `--hook` and `--shared`, does it.

**The search hook.** With `--hook`, Claude Code runs a hook after a `Grep`, or a
`grep`, `rg`, `ag` or `git grep` in the shell. When the pattern names a route,
channel, deployed function or handler that something in another repository
calls, publishes or handles, it adds a few lines beside the search's result:

```
flowatlas: this search saw the web checkout only; the graph also sees the other repositories.
- `GET /orders/:param`, in orders: callers in billing (1), gateway (1). who_calls({symbol: "entry:orders:http:GET:/orders/:param"}) lists them.
```

Otherwise it says nothing: a search for a string, a local helper or a `TODO`
gets no word. It never refuses a search, since a search is the way to read what
the graph could not, and a missing index, an input it cannot read or anything
slower than 300 ms is silence. It reads `<output>/names.json`, which `build`
writes, and not the database, so a search pays about one process start. It goes
into `.claude/settings.local.json`, which is yours, naming this machine's
files; `--shared` puts it in `.claude/settings.json` for the team, as
`flowatlas agents search-hook` with a path relative to the repository.

**The prompt hook: prompt cards (P386).** With `--hook`, Claude Code also runs a
`UserPromptSubmit` hook when a prompt is submitted. When the prompt names
something the graph holds, it adds, before the model's first turn, the compact
answer the tool for that thing gives, rendered by the graph server's own
tools, so a question the graph answers needs no call to ask it:

```
flowatlas, from the graph of every repository (built 3 minutes ago): each answer below is what the call above it returns, complete unless it says otherwise. Call a tool only for what this does not say.
who_consumes({channel: "channel:shop:*:orders#ORDER_CANCELLED"}):
{"channel":{"id":"channel:shop:*:orders", ...},"consumers":[...],"complete":true,...}
```

| The prompt names | Spelled | The card holds |
|---|---|---|
| a route | `GET /api/orders/{orderId}`, or a path alone (every verb of it); any parameter spelling | `who_calls`: its callers in other repositories and the ways in, with the code handling each |
| a method handling a route | `OrdersController.findOne` | `impact`: the ways in reaching it |
| a method sending a request to another repository | `OrdersApi.cancel` | `find_symbol`: where its requests land |
| any other method | `Mails.cancelled` | `impact`, only where its answer reaches another repository |
| a channel or a message type | `shop:*:orders`, `ORDER_CANCELLED` | `who_emits` and `who_consumes` |
| a deployed function | its deployed name | `who_calls`: what starts it |
| a service, beside "dead", "unused", "nothing calls", "still used" | `shop-api`, or its repository's folder | `dead({service})`, when nothing in it is named |

A name counts only spelled exactly as the graph holds it; a plain word
(`audit`, `PAID`, `fetchOrders`) only in backticks. A service the prompt names
picks among names several services hold. At most three names and 2,000
characters: an answer that does not fit is asked again with `detail: 0`, then
with fewer rows (the tool cutting it and saying so), and at worst named by its
call; names past three are named by their calls. Each name is answered once per
session (`<output>/cards-seen.json` keeps the ids, never the prompt). A prompt
naming nothing gets no word and pays one process start and one file read,
`<output>/card-names.json`, which `build` writes; only a prompt naming
something starts the graph server, read-only, about half a second on a small
project, and the hook gives up and says nothing past 5 seconds. Its calls are
not written to the question log. The prompt is read in the hook and nowhere
else. `--no-prompt-cards` leaves the prompt hook out (and takes out one written
before); `--shared` writes it as `flowatlas agents prompt-hook`, which starts
the whole command line on every prompt, so personal settings are the fast way.

**The edit hook.** `--hook` adds a second hook (P387), after an `Edit`,
`MultiEdit` or `Write`. When the edit takes out a name another repository
uses - a route declared in the file (its verb, its path, or the whole
declaration), a channel or a type of message published or taken there, a field
of a message or a request body sent there that the other side reads (or read
there that the other side sends, as a key or a member: `deskNo: deskNumber`
counts as `deskNumber` gone), a deployed function's name - it adds one line per
name, at most three and a count of the rest:

```
flowatlas: this edit took out `PATCH /items/:id/archive` (declared at line 22), called by storefront CatalogClient.archive (src/catalog.client.ts:25). Change them too; impact({symbol: "entry:catalog-api:http:PATCH:/items/:param/archive"}) lists every use.
```

A name is taken out when the file around the edit held it more often before
than after, and the file now holds it less often than when the graph was built:
a name moved within the edit, or written back, says nothing, and so does an
edit that touches no such name. A route's line the file holds more than once
(`@Get()` in two controllers) is taken as the lines after it until it is the
file's only one like it, and as the edited one only where the edit was. A
`Write` is compared with the file before when Claude Code passes it
(`originalFile`), and with the build otherwise. The hook reads
`<output>/edits.json`, which `build` writes beside `names.json` (each file's
names, how often the file spelled each and who uses it), and the edited file;
a name its file does not spell (a channel built from a constant) is not in it.
It never refuses or fails an edit, and anything slower than 300 ms is silence.
`--shared` writes it as `flowatlas agents edit-hook --edits <path>`.

---

## The tools

`detail` (0 to 3, how much of each row comes back) is taken by `list_entries`,
`find_symbol`, `search`, `get_flow`, `who_calls`, `impact`, `who_emits`,
`who_consumes`, `get_type`, `type_usage` and `what_changed`: 0 is ids only, 1 (the default)
adds `file:line`, service and kind, 2 adds what the reader knows about each
row, and 3 is answered at 2 and says so. Those tools, `check_contract`, `dead`,
`findings` and `check_rules` take
`maxNodes`, the most rows an answer holds: 150 by default, 60 for `get_flow`,
which also stops at about `maxChars` characters (12,000). `start_here`, `cant_follow`,
`describe_for_prompt` and `get_source` take neither: they are bounded by their
own limits (`perService`; `top` and `samples`; `maxSteps` and `maxChars`;
`maxLines`), as are `hot_paths`, `slow_steps`, `undeclared_failures` and
`never_seen` (`limit`), `trace_for` (`maxNodes` per tree), `get_spec`
(`maxChars`) and `test_pattern` (ten rules, ten tests a rule). Answers are
bounded and say when they were cut, rather than filling a context window.

The meaning and defaults of `detail`, `maxNodes`, `offset` and `service` are
said once, in the server's instructions, and each tool lists them by type alone
(P366); a tool whose bound differs (`get_flow`'s 60 rows) lists what differs.
`service` takes the name the configuration gives a service, or the folder of
its repository as the configuration's `repo` writes it (`shop-backend` for
`"repo": "./shop-backend"`), or either in another case (P377); a name that is
none of them answers `{error, services}`, the services there are, rather than
an empty answer.
Every call is still checked against the full bounds. The instructions, re-sent
by a client on every turn, are at most 2,500 characters: the tool to begin with,
the chains, the shared inputs and which tools are listed when. What one tool's
answer needs is said in that tool's description.

### Which tools appear when

Every tool's name, description and inputs are read by the assistant at the
start of a session, about 13,500 characters for all 27 tools. A tool the
project cannot answer yet would cost that and answer an error, so the server
lists only the tools whose needs hold. Tools follow what the project has, not
which frameworks it uses:

| Tools | Listed when | Read from |
|---|---|---|
| `start_here`, `list_entries`, `find_symbol`, `get_flow`, `who_calls`, `impact`, `search`, `describe_for_prompt`, `cant_follow`, `dead`, `findings` | always | |
| `get_source` | the server knows where each repository is (`--config`, not `--db` alone) | the server's options |
| `who_emits`, `who_consumes` | the graph holds a channel | the graph |
| `get_type`, `type_usage` | the graph holds a type | the graph |
| `check_contract` | a request or a message crosses between two places, or traffic was observed (traffic against a route) | the graph, the observed file |
| `get_spec` | the graph holds an HTTP route or a channel | the graph |
| `what_changed` | a `diff.json` or a `check.<env>.json` is beside the graph | the output directory |
| `check_rules` | the configuration has `rules` | the configuration |
| `test_pattern` | the readers are there to run a pattern (always under `flowatlas mcp`) | the server's options |
| `check_change` | the server was started with a configuration and the change checker (always under `flowatlas mcp --config`, or found from the working directory) | the server's options |
| `hot_paths`, `slow_steps`, `trace_for`, `undeclared_failures`, `never_seen` | an observed file is beside the graph (`flowatlas observe`) | the observed file |

Before any graph is built only the "always" tools are listed, each answering
that `flowatlas build` comes first, with `test_pattern`, which needs no graph.

The list follows the project while the server runs. It is decided again before
every `tools/list` and every call, when a build replaces the graph, and every
two seconds while a client is connected if the graph, the observed file or a
diff beside it changed. When it changes the server sends
`notifications/tools/list_changed` (it declares `tools.listChanged`), so after a
first `flowatlas observe` the run-time tools appear without a restart, and go
again if the file is removed.

`start_here` says in one line, under `hidden`, which tools are not listed and
when each appears (`check_rules: after rules[] in flowatlas.config.json ·
hot_paths, slow_steps, trace_for, undeclared_failures, never_seen: after
flowatlas observe`), so the assistant knows they exist. A client that kept an
older list and calls a tool no longer listed gets a failed call (`isError`)
saying what it needs, not a crash:

```json
{ "error": "check_rules is not listed for this project: no rules are configured; it appears after rules[] in flowatlas.config.json", "needs": ["rules"] }
```

The `mcp` block of `flowatlas.config.json` changes the choice:

```json
{ "mcp": { "tools": "auto", "include": ["check_rules"], "exclude": ["get_spec"], "rebuild": "off" } }
```

`tools` is `auto` (the default: by what each needs) or `all` (every tool).
`include` lists a tool whatever it needs, and the tool then answers for itself;
`exclude` never lists one, and a call of it says it is turned off. A name that is
no tool stops the server at start with a configuration error that names it and
the nearest tool (`mcp.exclude.0: no tool is named "check_rule"; did you mean
check_rules?`); a tool in both lists is refused too. `flowatlas mcp --all-tools`
lists every tool and ignores the block.

### The core tools, loaded upfront

Claude Code defers every MCP tool by default: a session sees the tools' names
only, and its first turn on a graph question went on a ToolSearch call loading
them, a turn that re-sends the whole session's context. Since P380 the server
lists nine core tools with `_meta: {"anthropic/alwaysLoad": true}`, which
Claude Code v2.1.285 and later loads upfront, so their schemas are there from
the first turn: `who_calls`, `list_entries`, `who_consumes`, `check_contract`,
`find_symbol`, `impact`, `search`, `get_flow` and `dead`, the tools agents ask
most. The rest (`who_emits`, `get_source`, `start_here`, …) load by ToolSearch
when a question needs them, every one needed in one call; the instructions say
so, and the guide `flowatlas agents install` writes tells no ToolSearch call
for the core tools. One list (`CORE_TOOLS`) is what the server marks and what
the guide names.

An upfront tool is paid on every turn of every session, asked or not, so the
nine are listed lean: their model-visible listing (name, description, input
schema) is 5,655 characters (about 1,400 tokens) on the main fixture (5,633 before P382), held
under `UPFRONT_LISTING_MAX` (5,700) by the tests and the [answer
budget](#the-answer-budget-p373); a listed schema leaves out the lower bounds
that say nothing (`minItems: 1`, `minLength: 1`, `minimum: 0` or `1`, still
checked on every call), and the instructions leave out what the core tools'
descriptions say. Each upfront description stays under the 4,096 characters
Claude Code keeps of one.

To load fewer of them upfront (P392), `"mcp": { "upfront": ["who_calls",
"impact", "search", "get_flow"] }` in `flowatlas.config.json`, or `flowatlas
mcp --upfront who_calls,impact,search,get_flow` in the server's command (the
command line first): only those are marked, the others load by ToolSearch
with every other tool a question needs. Four schemas instead of nine ride
every turn, including the turns of a session that never asks the graph,
against a ToolSearch turn the first time a fifth tool is needed; the public
benchmark's arm G measures which pays (`scripts/bench-agent`). Only core
tools can be named, each once; any other name stops the server at start with
a configuration error naming the nearest core tool. `agents install` reads
the list from the configuration or the `.mcp.json` entry's `--upfront` and
writes into the guide which tools are loaded already.

To keep every tool deferred:

- `"mcp": { "alwaysLoad": false }` in `flowatlas.config.json`, or
  `flowatlas mcp --no-always-load` in the server's command: no tool is marked,
  and the guide `agents install` writes says the one ToolSearch call that loads
  the core tools;
- or, in Claude Code's MCP configuration, `"alwaysLoad": false` on the
  server's entry (Claude Code v2.1.287 or later), which defers every tool of
  the server whatever it marks; `agents install` reads it from the
  repository's `.mcp.json` and writes the guide to match.

### Answers

Every answer is one compact JSON document, in the text content and again as
`structuredContent`, so a client reads whichever it prefers. Claude Code hands
the model `JSON.stringify(structuredContent)` on a success, so the two are
held to be the same characters (the [answer budget](#the-answer-budget-p373)
fails otherwise, P382): what is measured is what the model reads. The two
tools whose answer is a text to read answer compact as that text, with no
structured content to escape it into (P382): `get_source` the code (a line
saying the id and the lines, the code, then each other field on a line of
its own) and `describe_for_prompt` its Markdown (then whatever the Markdown
does not already say). `verbose: true` gives either one's JSON document.
`start_here`, `list_entries`, `find_symbol`, `who_emits`, `who_consumes`,
`get_type`, `search`, `cant_follow`, `dead`, `findings` and `type_usage`
declare an `outputSchema`, and a
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
`rows`), `check_rules` (its `violations`) and `type_usage` (every group at once) take `offset`, 0 by default. An answer
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

**Compact by default, `verbose` for every field.** An assistant pays for every
character of an answer on every later turn, so what it is handed leaves out
what the ids in it already say. Every tool takes `verbose` (default `false`);
`verbose: true` answers exactly as the tool writes it, field for field. Without
it, every answer passes through one compaction where answers are serialised,
whichever tool wrote it:

A row's ids are its `id` and, on a gap, its `gapId` (`gap:<service>|<file>|<reason>`).

| Left out | When |
|---|---|
| `type` | when an id starts with it (`consumer:`, `entry:`, `channel:`, `gap:`), and `method` on a symbol whose id ends `Class.member`; a `function` or a `class` stays |
| `service` | when an id names it (`orders#…`, `consumer:orders#…`, `entry:orders:…`, `gap:orders\|…`); a channel's stays |
| the file of `loc` | when an id holds it: `loc` becomes `line` (`"line": 311`), or goes when the id holds the line too (a request's id); a `loc` whose file no id holds stays as it is. A screen's `loc`, a line of its routing table, goes beside the `by` naming the component it shows, whose file is the one to read (P379) |
| `label` | when it is the id's tail, as written (`Notices.digest`, `order.created`) or said aloud (`GET /orders/:param` beside `entry:orders:http:GET:/orders/:param`); a request's `GET /orders` stays |
| `kind` | when a way in's id says it (`entry:<service>:<kind>:…`) |
| any other field | when it is a part of the row's id (its tail, or a whole part between `:`, `#` and `\|`: a gap's `reason`), the tail of an id the row's `meta` says in full (`selectedIn` beside `meta.selectedBy`), or the id of the row it is under (`meta.selects[].consumer` on that consumer) |
| a `meta` key | when it says again a field of the row (`meta.kind` beside `kind`), a part of the row's id (a way in's `meta.method` and `meta.path`), or a word of its `label` (a request's `meta.method` and `meta.path` beside `GET /orders/:param`) |
| null, `false`, `[]`, `{}` | on every row below the answer; the answer's own fields stay, since an empty `consumers` or `dead: false` there is the answer |
| `next` past two calls | when the list was cut, `next` is the paging call alone |
| `truncated`, `stoppedBy`, `frontier` | where the answer (or one of the answers of a call asked several things) says `left`, which says each cut; `next` holds the call that walks on (P370) |
| a tree's `node` wrapper | a row of a tree (`get_flow`, `who_calls`) is said as the node itself with `edge` and `children` beside its fields: `{"id": …, "line": 31, "edge": "calls", "children": […]}` (P370) |
| an edge's `confidence: "static"` | the confidence an edge has unless it says otherwise; an edge with nothing left but its type is said as the type (`"edge": "handles"`), one with types or a weaker confidence as an object (P370) |
| a long type written inline | on a step of a tree (`get_flow`, `who_calls`), an edge's `params` and `returns` and a type its `meta` holds (a signature's `type` and `returns`, a request's `bodyType`) longer than 48 characters say each object type written inline by its size: `{…22 fields}`, `Observable<{…22 fields}>`. Type names and short types stay; the answer says once, in `note`, that `verbose: true` gives them whole (P379) |
| a list row's structured `meta` | on a row of a list (an element of a list below the answer's own fields, with an `id`, not a step of a tree), a `meta` value that is a record or a list of records: a route's `fails` and `access`, a method's `signature`, a consumer's `selects` and `subscriptions`. Strings, numbers, booleans and lists of them stay. The answer says once, in `note`, which keys went and that `get_flow({entry: id})` or `impact({symbol: id})` at detail 2 gives one node's and `verbose: true` every row's (P375) |

`id`, `gapId`, `complete`, `left`, `reach` and `from` are never left out.

On the fixtures the compact snapshots cover, P370's three rules take a further
8% off thirty answers (60,262 characters to 55,635): `get_flow` at detail 1
0.83-0.85 of P365's compact answer, at detail 2 0.88-0.90, a cut `get_flow`
0.83, `who_calls` 0.78-0.88; the rows of a tree were about 30% wrapper and
edge. With the unreached chain ends no longer listed by `impact`, 53,453.

`line` rather than a shortened `loc` reads one way only: a number is a line of
the file the id names. A field the compaction does not know is kept, so a field
a tool adds is handed on whole. `detail` means the same in both: `detail: 2`'s
`meta` stays, less its repeats, on one node (`impact`'s and `who_calls`'
target, `who_consumes`' channel, a step of `get_flow`); a row of a list keeps
its plain facts only, since what a list is asked for is which rows, and the
heavy facts of one node are that node's call (P375): asked at detail 2,
`impact` handed every row every exception any code under its route can throw,
several times the size of the same rows at detail 1. On the `rows-name-handling-code`
fixture, whose cancel route refuses six ways behind two guards, `impact` at
detail 2 answers 1,580 characters where it answered 2,717 (verbose: 4,253),
`list_entries` of the back end's routes at detail 2 2,288 from 4,376,
`find_symbol` 2,238 from 3,750, `search` 974 from 2,083 and `who_consumes`
2,157 from 2,771. `get_source` is never compacted, and neither is
the Markdown of `describe_for_prompt`; the page, the exported graph and the
reports show everything. Since a compact answer may leave any field out, the
`outputSchema` a tool lists requires none, and a row that may say `loc` may say
`line` instead.

On the fixtures' graphs (the main project, the message types chosen by
screens, the routed screens and four more), the answers of the tools an agent
calls most are a quarter smaller compact: `list_entries` 0.54 of the whole
answer, `find_symbol` 0.57, `who_consumes` and `who_emits` 0.61, `impact` 0.65,
`search` 0.68, `who_calls` 0.69, `get_flow` 0.71, `dead` 0.87 and
`describe_for_prompt` 0.93 (its Markdown is not compacted). A fixture's rows
were already slim at `detail: 1` (`label` and `service` said once in a tree);
what is left is the ids, the edges and `next`. On a project whose files sit
deeper, each row's `loc` and `label` were longer, and the share left out is
larger. `expected.mcp.compact` beside three fixtures holds compact answers
beside the whole ones in `expected.mcp`.

#### The answer budget (P373)

What an agent pays for a question is the fixed overhead of a turn, times the
turns it takes, plus the answers it was handed, each sent again on every later
turn. The instructions and the listing have ceilings in the tool tests; the
answers and the turns have the answer budget, `scripts/answer-budget.mjs`,
part of `pnpm fixtures:check`. It asks a fixed list of questions an agent asks
(`scripts/answer-budget.json`) of the fixtures' graphs, through the server, as
an agent does: compact, no `verbose`. For each answer it records the
characters of the text the agent is handed (tokens estimated as characters /
4), the rows of the answer's main lists, whether it says `complete`, and how
many calls the question takes when the agent follows what the answer names:
the page `nextOffset` gives, or the same call asked further (a deeper
`who_calls`), every call's characters counted.

Beside each question is its right answer, written by hand and never
recorded: the ids a list must hold, the ids it must not (on `impact`, the ways
in that do not call the changed code), a list that must hold exactly the ids
given (each row once: a row of `throughChannels` is matched by its
`consumer`), what a row must say (`dead`'s verdict, a row's `reach`) and
whether the answer is complete. The gate fails when an answer grows more than
10% past its recorded size, or 300 characters if that is more; lists an id it
must not, or an id of an exact list twice;
misses one it must; says `complete: false` where the right answer is
complete; takes more calls than recorded; or answers complete and still took
more than one. The fixed overhead is held the same way: the instructions, the
guide block and skill description `flowatlas agents install` writes (read on
every turn), and the listing a model reads for the core tools the server
lists to load upfront (read on every turn too since P380: the tools marked
`anthropic/alwaysLoad`, which must be exactly `CORE_TOOLS`, and whose listing
must also fit `UPFRONT_LISTING_MAX`), the tools the main fixture is offered and
all of them. Since P382 it measures the instructions of a server started on a
database alone too (`instructionsDb`, both held under `INSTRUCTIONS_MAX`) and
the short `CLAUDE.md` block (`guideBlockClaude`); it fails an answer whose
text is not `JSON.stringify(structuredContent)`, what Claude Code hands the
model; and an answer handed on as plain text (`get_source`,
`describe_for_prompt`) is held to the strings its text must hold (`says`) and
must not (`saysNot`).

P382 added five, each one call: `check_contract` with `route` and the route's
parameter named as the caller names it (394 characters, where the call
answered a 49-character error and the agent grepped), with a type of message
two channels carry given as the channel (1,300, both channels, where it
answered "no channel" and took two more calls, 1,384), with a type one channel
carries (664, where it took an error and a second call), `get_source` on a
controller (its skeleton as plain text, 1,322, where it answered the class's
code escaped in JSON, 1,769), and `get_flow` at detail 2 on the cancel route
(5,186 where 6,219: no reader's meta, no edge types the step's signature
says, no fails and guards twice). Two answers already budgeted fell for the
same reason: `get_flow` at detail 2 on a route 2,766 to 2,143, and on a
screen's method 1,933 to 1,668. The instructions went from 2,384 to 2,368
(2,426 to 2,428 on a database alone, `service` now saying where the thing is), the guide block from 1,055 to 1,054,
and in a `CLAUDE.md` read beside the instructions to 366; the listing grew by
`get_source`'s `whole` and `verbose` and `check_contract`'s description saying
a route and a type alone (core 5,633 to 5,655, offered 10,321 to 10,428, all
12,904 to 13,011).

`node scripts/answer-budget.mjs --table` prints the table, the fixed overhead
first and then each question; `--update` re-records the sizes (never the
right answers) and prints each beside what it was. **A change that grows an
answer re-records with `--update` and says why in its commit**, so a growth is
read before it is accepted rather than slipping in with a snapshot.

P375 added four: `impact` at detail 2 (1,580 characters, the rows without
their failures and guards), the route row counting the rows reached through it
(`rowsVia`), `dead` on a controller judging each of its four routes (1,025)
and `list_entries` with `in` and `reach: "dead"`, exactly the two routes no
code calls (475).

P378 added three on `impact-guarded-navigation`, whose bot takes messages from
three channels: `impact` on the list method says the bot once under
`throughChannels`, its three channels and five distinct ways in (2,387
characters, from 3,032 with three rows repeating the routes and samples),
`who_calls` on it counts them with no sample (1,961, from 2,983), and `impact`
with `channel` the bot's consumer lists the five (1,440; it answered none).

P379 added four on `callers-walked-to-ways-in`, whose products controller
declares five routes, four requested by two screens' client: `who_calls` on the
five routes answers each one's request and the two screens once, complete, in
2,381 characters (2,682 before, a screen's routing-table line on each row and
the create's body of 22 fields said whole), and asked with `depth: 1`
the same 2,381 (2,834 before, five incomplete trees and no ways in); `get_flow`
on the catalog screen's add method at detail 2 answers 1,933 (3,808, the body
said whole on the edges, the signatures and the request's `bodyType`); and
`list_entries` with `in` says who calls each route in 1,152 (835, after which
the agent asked `who_calls` on every route: two calls, 3,517). The screens'
routing-table lines went from every compact `impact` and `who_calls` answer
listing a screen: 32 to 66 characters each.

On P373's tree a turn carries about 3,960 characters of instructions, guide
block and skill description (about 990 tokens), 9,340 with the core tools
loaded. One `impact` call answers which ways in could break in 749 to 1,477
characters; `who_calls` on the main fixture's service method took three
calls and 13,567 characters, since its default depth stopped twice before the
ways in. Since P376 it answers in one call of 2,004, the ways in listed once
each.

"Which handler does this front-end method's request land on" is one call since
P377 (`request-lands-on-route`): `get_flow` on `CatalogService.getGrouped`
answers 1,485 characters where it answered "no entry matches" and took
`find_symbol` and `get_flow` on the full id after it (three calls, 1,912);
`who_calls` on it says the route and handler on its target in 999 (829, and
`get_flow` on the full id after: two calls, 2,314); `find_symbol` on
`DeskOrderService.amendOrder` in 536 (two calls, 1,889); `search` for the
client's path `/admin/:rid/orders/${id}/modify` in 436 where it answered
"nothing matches"; `search` with the repository's folder as `service` in 411
where it answered "nothing matches" and the services had to be read from
`start_here` (three calls, 1,922). Rows that send requests now say where they
land: `find_symbol.several` grew from 965 to 1,380 characters,
`find_symbol.unreferenced` from 656 to 922.

`search` and `find_symbol` take a sentence since P383
(`search-takes-a-sentence`). Every name is split into its words once (camel,
snake and kebab case, path segments, lower case) and stored with the graph in
an SQLite FTS5 table whose tokenizer stems them, so "cancelled" meets
`cancel` and "payments" meets `PaymentsClient`. A query's words, stop words
("where", "is", "the", `OR`) and single letters dropped, are each asked for;
only the names holding as many of them as the best do are kept ("order
cancel" is what holds both, where anything does), ranked by how many the name
holds, then by kind (a way in, then a handler, then code, then a class), then
by `reach` (code that runs first), then BM25 with a name weighted five times
its service and file. `search` answers them as `best`, at most `limit` rows
across every kind (methods and functions too, which no kind lists), when no
kind holds the query as a name or the query is a sentence; `find_symbol`
answers them as its `matches`, ten to a page, when no name holds the query as
written. Each row says the words it holds (`matched`); the answer is never
`complete`, and `left` says `fuzzy: ranked by the words …` with how many rows
hold as many and how many fewer. A site in code (a request, a query, a
publish) is never a row: the method it is written in is. A database written
before the words were stored is indexed in memory on its first search, by the
same code. On `multi-repo`, `find_symbol` for "order cancel" answers the
cancel route, its handler and `OrdersClient.cancel` in 919 characters where it
answered no match, complete (40), and `search` for "where is the order
cancelled" the same three in 896 where it was an error; on
`search-takes-a-sentence` "what handles payments" answers the payments route
first and every name for payments (1,515), `cancelOrder` the cancel route and
`OrdersClient.cancel` (1,173), and "cancel OR refund" both routes (1,774), each
an error or no match before.

A complete answer whose `next` still names the same call asked further (a
deeper `who_calls`, the next page) fails the budget too (P376): the agent
would ask it, so the answer was not the whole answer after all.

#### Answers that finish in one call (P364)

An answer says what an assistant would otherwise check row by row, so the
question is answered in the call that asked it.

- **Whether a row runs, and where it is reached from.** Each row naming code
  in `who_calls` (the target and every caller), `who_consumes`, `who_emits`,
  `impact` (the target and each way in), `search` (routes, channels, message
  types, classes, failures) and `find_symbol` carries, at `detail` 1 and up:
  - `reach`: read off the verdict `dead` gives, by the same functions (one
    judge per answer, which reads what every verdict needs of the graph
    once), and never a maybe said as a no (P367):
    - `alive`: a way in reaches it.
    - `maybe`: `dead`'s `likely-dead`, or nothing read reaches it but a call
      the reading did not follow could: the walk below ends at code nothing
      read calls, judged `likely-dead` (a method of a class that is used, a
      function), said unknown with nothing outside named (a component a
      template may render by its tag), or in a file with a step the reading
      could not follow and says why (a call through a receiver with no class;
      a request that found no route is not one). The row names it: `gap`,
      that step's gap id, and `behind`, the code the chain stops at when it is
      not the row itself; a way in that is a maybe (a request one segment
      off) says in `behind` why `dead` says it may be called.
    - `unreached`: no way in reaches it, and no unread call could - also
      where `dead` says `likely-dead` of code whose name its repository
      writes nowhere but at its declaration (`evidence.unreferenced`: no call,
      no reference by name or string key, no template binding, no value
      handed on; comments do not count) and its file holds no step the
      reading could not follow, since an unread call writes the name it
      calls (P370). A front end's methods and components are judged this way;
      not a member of a class that extends or implements anything, a
      decorated member, a framework's `ng…` hook, nor anything in a
      repository whose manifest publishes an entry (`main`, `module`,
      `exports`, `types`).
    - `dead`: as `dead` answers; or code is called, but every way in that
      reaches it is judged dead and every chain back from it ends at one
      (`throughDead: true`, P381).
    - `outside`: something outside the project calls it - a webhook, a bot
      update or command, a cron, a screen opened at its address, a public
      route, a class from a library. A way in is never doubtful just because
      its caller is outside: `dead`'s `unknown` with what is outside named,
      or on a way in nothing reaches and no call one segment off names.
    `unknown` is not said. A publish or a request, which `dead` does not
    judge, takes the liveliest verdict of the code it is written in.
  - `from`: the nearest way in, short - `screen /queue`, `GET /orders/:param`,
    `cron nightly`, `consumer tenant:*:events` (a handler whose channel nothing
    read publishes to), with `(service)` after it when it is another
    service's - or `none`; on a `maybe` row nothing read reaches, the nearest
    way in beyond the unread call where the code it is written in is known,
    and `behind` otherwise. A walk back from the row finds the first ways in on
    each path (it does not walk past one), the row's own service first, then
    the nearest; besides the edges every caller walk follows, a consumer runs
    in its handler, a component's method and a handler's file where the
    component is shown, and a handler's class where it is injected. Code
    with callers the reading knows runs where they run: the hop from a
    method to its class, and from the class to what injects it, is taken
    from a component's method, from a handler a consumer runs, and from code
    nothing read calls, never from a method its callers are walked from
    (P371). A consumer whose handlers run in a component a way in shows (a
    screen's subscription to a stream) runs in that screen, and is not walked
    back onto its channel: what publishes to it pushes a message to an open
    screen, it does not start the code behind it. A consumer no screen holds
    (a back end's worker) is walked back onto its channel as before. A call written where a way in is registered
    (`bot.command('items', (ctx) => this.showItems(ctx))`) is the way in's,
    not the registering method's. A consumer that chooses by type is walked
    through the types it selects, not every publish of its channel. `ways`
    counts the ways in where there are several. A way in's own row has no
    `from`.
  - The walk reads at most 300 nodes per row and 20,000 per answer, each node
    and its edges read from the database once per answer, and at most 400
    rows are judged: `walkCut: true` says a row's walk stopped at its bound
    (`ways` is then a floor, and no `from` means none was met within it); rows
    past the answer's bound say nothing, and `left` says how many.
  `dead({id})` carries `from`, `ways`, `gap` and `behind` the same way.
  - `confirm` on a `maybe` row (P393): how to settle it in one search,
    `{ grep, repo }` - the name of the code an unread call could reach (the
    row's own, or the code its chain stops at: a method's or a function's
    name, a class's), to look for as a whole word (`grep -rnw`) in the
    repository (the service) it is in. A hit other than its declaration is
    the call the reading did not follow; none means nothing calls it by name.
- **Where a row's code ends (P393).** A row naming a method, a function, a
  class, a component or a handler, at `detail` 1 and up in every answer that
  says reach and in `get_flow`'s tree, carries `endLine` beside `loc`, so a
  Read goes straight to `line`-`endLine`. The graph records where a
  declaration begins; its end is read from the checkout at answer time by the
  brace count `get_source` cuts a symbol with (a brace closed inside the
  parameter list, an inline type, does not end it), where the repository is
  checked out here, the count met a brace and ended past the first line;
  otherwise it is left out, never guessed. Compact, it goes into the line:
  `line: "12-40"` (or `loc: "src/a.ts:12-40"` where the id does not hold the
  file).
- **Several inputs in one call.** `dead` takes `ids`, `find_symbol` and
  `search` take `queries`, `get_type` takes `types` and `who_calls` takes
  `symbols`, beside the single form, at most 20, the single one first and
  repeats once. Each is answered by the same code in turn, bounded as one is,
  under `answers`, each with the input it answers as `asked`; `next` holds the
  first hints of each.
- **Whether a list is the whole answer.** `who_calls`, `impact`,
  `who_consumes`, `who_emits`, `search`, `find_symbol`, `list_entries`,
  `dead` (its rows), `get_flow` and `get_type` say `complete: true` when they
  hold every row the graph has and nothing on the way was left unread;
  otherwise `complete: false` and `left`, each thing cut or unread in a few
  words: `page: 4 more rows from offset 2`, `depth: 3 callers past depth 3,
  from the frontier rows`, `maxNodes: …`, `walk: stopped at 4000 nodes`,
  `gaps: 2 unread in its file, any may call it`, `unread: 2 publishes on
  tenant:*:events send a type not read; any may be ORDER_READY`, `unsure: no
  code that runs selects …`, `unread: 3 steps on the path could not be
  followed`. Several answers are `complete` only when each is. An answer that
  says `complete: true` needs no grep to confirm it.
- **`next` names only calls that add something.** No `dead` on a row that
  shows `reach`, no `who_calls` or `search` for a row that shows `from`; the
  call that pages or walks on from a cut stays first. `dead` on a node with
  several ways in suggests `impact`, which lists them all.

#### Answers never falsely complete (P381)

An answer that says `complete: true` is the whole answer to what was asked;
a filter, a near name or a verdict never makes a half answer look whole.

- **`service` picks the symbol.** On `who_calls` and `impact` it picks among
  same-named symbols (a route said aloud is matched among that service's
  routes alone) and cuts no caller of one it holds: `who_calls({symbol: "GET
  /api/items", service: "market-api"})` lists the screens and the bot in other
  services that request it, where it answered "nothing reaches this",
  complete. `callersIn` keeps the ways in of one service; a service the
  symbol lies outside (asked by id) still does. Whatever a filter leaves out
  is said - `filter: 2 ways in in other services left out (callersIn:
  reader-web)` in `left`, `complete: false`, the call without it in `next` -
  and `who_consumes` and `who_emits` say the ends their `service` left out the
  same way.
- **A name that means two or three is answered for each.** `who_calls` and
  `impact` answer every node such a name means under `answers`, the liveliest
  first (by `reach`, then by how many ways in or callers each has), with
  `ambiguous` saying so: both services' `GET /orders/:param` in one call,
  where the candidates took a second. More are still listed as candidates.
  A name nothing holds answers the nearest names (initials, inside an id, a
  few edits away) with `fuzzy: true`, `complete: false` and `left` saying no
  name holds it; nothing near at all is an error naming `find_symbol`.
- **Several in one call, said any way.** `impact` takes `symbols`, one change:
  one walk from all of them, every way in once, `targets` for the symbols
  and `unresolved` for any that names no one node. `who_consumes` and
  `who_emits` take `channels`, each answered under `answers`. Wherever a call
  passes, `ids` is the tool's own list (`symbols`, `queries`, `types`,
  `channels`), a list in the single input (`symbol: ["a", "b"]`) is the list,
  and one string in the list is the single input, so the habit a guide
  teaches works on every tool without costing the listing a word. An answer
  of several that answers one of them with an error or candidates is not
  complete.
- **Impact by kind.** `byKind` sums every way in that breaks, on any page, by
  kind (`screens`, `routes`, `bots`, `consumers`, `jobs`, `functions`) and
  service, each the file of the code that handles it:
  `{"screens": {"reader-web": ["src/app/book-page.component.ts"]}, "bots":
  {"desk-bot": ["src/desk-bot.ts"]}}`. `changing` names the routes the
  changed code runs behind - a route of its own service whose handler calls
  it, reached through no other way in - which change rather than break.
- **Facts before verdicts.** `dead` on a route or a method says `callers: 0`
  beside the verdict where no caller in the project joins it; `waysIn` rows
  of a class or file say `callers` always, and `uncalled` counts every way in
  no caller joins that nothing outside is said to call - judged `dead`, or a
  maybe (a request read in part, one a segment off) - not the `dead` verdicts
  alone. Code that is called, but whose every way in is judged dead and every
  chain back from it ends at one, has `reach: "dead"` with `throughDead: true`
  on every row that says reach, and on `dead`'s answer beside its `alive`
  verdict: it runs only when a dead way in runs. `list_entries({called:
  false})` lists the ways in no caller joins (a request, a link), the fact;
  `list_entries({reach: "dead"})` says in `left` how many more no caller joins
  are judged a maybe, `complete: false`, with the `called: false` call first
  in `next`.

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

The server's instructions name the one call for each question instead
(P382), with the name as the question has it. `list_entries`,
`find_symbol`, `search`, `who_calls`, `impact`, `who_emits`, `who_consumes`,
`start_here`, `what_changed`, `cant_follow`, `dead`, `findings`, `type_usage`,
`check_rules`, `test_pattern` and the traffic tools `hot_paths`, `slow_steps`,
`undeclared_failures` and `never_seen` all take the same optional `service`
filter; `get_spec` requires one.

| Tool | Answers | Takes |
|---|---|---|
| `start_here` | nodes, entries by kind and open gaps per service, the unresolved rows counted by kind (`counts`), the five most common gap reasons with an example, channels with one end missing, a few entry ids to start from, `missingRepos`: the repositories probably missing from the project, at most three, by name with the directories that look like each, with rules configured `rules: { errors, warnings, unchecked }` (`next` then starts with `check_rules()`), and with a `check.<env>.json` beside the database `checks`, one line of each environment's verdict (`prod: not deployable · staging: deployable`; `next` then starts with `what_changed` on the first that is not deployable) | `service`, `perService` |
| `describe_for_prompt` | one entry, channel, symbol or gap as Markdown to hand on: what is in front of it, what it can fail with, the steps in call order with repo-relative `file:line` and their marks, shapes in and out, gaps with their reasons, and the calls to make next with their ids; or, with `scope`, a whole class, file or service (a service's gaps are the rows nobody accepted; the page's *Copy as prompt* writes every scope the same). No source code; bounded by `maxSteps`, at most 12 failure lines (one per status and exception), 10 gaps, 4 consumers of a channel, 40 methods or nodes of a class or file, and `maxChars` | `id` (required: any id, a gap id, a place as `file:line` or `service#file:line` - the gap written there - a channel name or a route said aloud; a service name or `service#path` for those scopes), `scope`, `maxSteps`, `maxChars`, `withSpec` (the OpenAPI or AsyncAPI fragment of a route or a channel end, P118) |

`describe_for_prompt` and the page's *Copy as prompt* write the same text
(P97): each gathers one subject - the server from the database, the page from
its packed model - and core's `renderPrompt` writes it. With an observed file,
a way in's hits line and a step's marks carry its p95 and, when any request
failed, its error rate (`[seen ×20, p95 79 ms, 5% errors]`): the join into the
step's figures, else the step's own span's (P111). The headings are the
same for every subject:

- `# Way in: …`, `# Channel: …`, `# Check: …` (a gap id) or `# Symbol: …`, then
  the id line (`` `id` — type / kind in service at `file:line` ``) and, for a
  way in, its schedule and the hits seen at run time.
- *In front of it* (the checks and opt-outs, P76) and *Can fail with* with the
  statuses in the heading, one line per status and exception with how many
  places raise it (P87).
- For a way in seen at run time, *Failures seen at run time · n hits, <window>*
  (P106): each status it answered that no failure declares (`**500** ×4, 10% of
  requests — not declared`, with `expected: <why>` where the framework answers
  it anyway and `maybe <exception>` for a declared failure that names no
  status), each declared one traffic answered (`declared, seen ×n`; an assumed
  one says traffic settled it), and each declared one no request answered in
  the window (`declared, never seen in the window`), or that the hits were too
  few to say so.
- *Rules it breaks · n* (P114): each architecture rule a violation of runs
  through the subject or one of its steps (for a service, any of its nodes),
  with its severity, what crossed, where, `(best guess)` along a guessed edge
  and the rule's note. The server writes it; the page's *Copy as prompt* has no
  rules to read and leaves it out.
- For a channel, *Published by · n* and *Consumed by · n*, each consumer with
  the steps under it; for a check, *Where · n*, every row of the gap id at its
  line with the node it is on, then *How to close it*: one line per way that
  applies to its reason - link the repository that answers it (naming the one
  probably missing, when the gap is its evidence), a setting, an alias, a
  pattern, a shape file, the annotation meant for it, or the advice on its
  places - from the one table `doctor` and the page read too, and last the
  `flowatlas accept` line that takes it; for a symbol or a check, *Reached
  from*, the ways in that reach it.
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

The page gathers a class, a file and a service the same way (`subjectOf` in
its `steps.js` takes them as targets, and the parity test compares both sides
on every class, file and service of every built fixture), and its *Copy as
prompt* offers each scope a node has (P134).

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
`gapId` (`gap:<service>|<file>|<reason>`) is the one `flowatlas accept` takes,
and `next` starts with `describe_for_prompt({id: <gapId>})`, the gap with how to
close it. `cant_follow` hands on to the same prompt for its first place.
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
| `dead` | whether one node is dead, with what could make that wrong; on a class or a file, each way in it declares, judged (`waysIn`); or, without `id`, every row `flowatlas dead` lists, verdict first | `id` (or `ids`), or `service` and `kind` (`entries`, `channels`, `providers`, `methods`), `maxNodes`, `offset` |
| `findings` | what looks broken between the services first, then every other finding, counted by kind with the top three of each, each with its precision, contract breaks at warning counted under `warnings`; with `kind`, one kind ranked by reach | `severity` (`error` or `warning`: only rows at it, the warnings listed), `kind` (`call-to-missing-route`, `field-never-sent`, `answer-field-never-returned`, `type-never-published`, `contract-break`, `unguarded-among-guarded`, `annotation-to-missing-route`, `env-not-set`, the protocol, settings, status and CORS kinds of P388 below, `n-plus-one`, `unguarded`, `one-ended-channel`, `rule`, or a finding's reason), `service`, `maxNodes`, `offset` |
| `check_rules` | the architecture rules of the configuration (P114), checked over the graph: each rule's status (`held`, `broken`, `unchecked`), each violation with its two ends, where it crosses (`loc`), the edge kind, the weakest confidence, `heuristic` for a guess, the rule's note and `next` (`get_flow` on the way in it starts behind, `get_source` on the crossing), the rules that could not be checked (`rule-matches-nothing`) and how many an accept excused | `rule`, `service`, `maxNodes`, `offset` |

`check_rules` calls the function `flowatlas rules` calls (the linker's
`evaluateRules`), with `accepted.json`'s `rule:<name>` entries excusing what
they cover, so the two list the same violations. A `get_flow` step whose hop a
violation runs along carries `violates: [rule names]`, and a broken rule is a
`findings` kind of its own (`rule`, ranked by severity, then by the ways in
reaching where it starts, shown by `check_rules({rule})`).

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
  or controller judged by the way in or route that decided it;
- `seen` (`{ count, lastSeen, window }`) and `neverSeen` (`{ window,
  confidence }`) when an observed file sits beside the graph (P110): seen in
  the window is `alive` whatever the code says (and a route the build found
  nobody calls says static reach missed a caller); never seen is `strong`
  beside a sibling seen 20 times or more, over a window the file holds in
  full, and `weak` otherwise. A way in nothing in the code reaches that was
  never seen, strongly, is `likely-dead` rather than `unknown`; a static
  `dead` keeps its verdict with the silence as corroboration. `dead` reads all
  the file holds; `never_seen` and `flowatlas dead --since` cut the window.

`dead({id})` takes a way in, a channel (by its bare name too), a class, a
method or a function, by any name the other tools take; a controller is as
alive as its liveliest route. On a class (a controller, a bot's class) it also
lists each way in the class declares by its methods handling them, under
`waysIn`, each `{id, verdict, reason?, callers?, caller?}`: an alive one with
how many call it and the first, any other with why; `uncalled` counts those
judged `dead` or `likely-dead`, `next` is `get_source` on the first of them,
and the answer is `complete`. "Which routes of this controller does no code
call" is that one answer, where listing every route under a path and reading
off the controller's was the way (P375). A
file (`src/reports/reports.controller.ts`, or the end of its path) answers the
same for the ways in written in it or handled by code written in it, as
`{file, waysIn, uncalled, complete}`. Without `id` it lists entries, channels and
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

**What looks broken between the services comes first (P384).** The graph
already holds mismatches that are defects where one more fact holds; each is
listed only where that fact (its evidence) holds, and carries `precision`
(`high`: a defect nearly every time, `medium`, `low`), `evidence` (the fact, in
words), `fix` (the nearest fix) and `seenBy` (the ways in that meet it):

| Kind | What | Evidence | Precision |
|---|---|---|---|
| `call-to-missing-route` | a request to a route the service it is sent to does not serve (a `target-route-not-found` row) | every route of that service was read: no row says a route, a mount or a prefix of it went unread, and no catch-all of it could answer | high |
| `field-never-sent` | a field the receiving code reads that no sender sends, on a channel (type by type) or a request's body, with the field sent and never read it was likely renamed from (`likely renamed: deskNumber is sent, deskId is read`) | every sender's shape and every reader on the crossing was read (`check_contract` answers `complete`) | high |
| `answer-field-never-returned` | a field of a route's answer a browser client reads (P391's `answerRead`) that the answer never holds, per request, placed where it is read, with the field returned and never read it was likely renamed from, else "return it, or stop reading it" (P393) | the route's handler declares an answer that is a shape read whole (a type, an inline object, a list's or a promise's element); where it is not (`any`, a value parsed from text), the request's reads are held back, one count per request; a read behind a check that the field is there (`?.` past it, `??`, `\|\|`, `&&`, `if (x)`, `!x`, a ternary on it, `== null`, `typeof x === 'undefined'`, `'k' in o`, also through a local holding it or anywhere in the functions around the read, P395) is the client handling its absence, held back, one count per read | high |
| `type-never-published` | a consumer choosing a type of message no publish on any channel it receives sends, with the published type it was likely respelled from; a screen fed through a stream route or a hub receives every channel that route or hub relays (P395) | every channel the consumer receives is known whole and every publish on each says the type it sends; held back where a stream route feeding it relays a channel not read (`meta.relaysUnread` on the route: a subscription whose channel is worked out when the code runs, an object whose class is not read), where a hub is written to with a channel not read (`meta.forwardsUnread` on its channel), where nothing publishing on one of several channels was read, or where a publish sends a type not read | high |
| `contract-break` | the contracts report's errors, listed; its warnings counted under `warnings` with the call that lists them (`findings({kind: "contract-break", severity: "warning"})`, P395) | the two declarations | high at error, medium at warning |
| `unguarded-among-guarded` | a route nothing guards while the routes beside it in its controller are guarded | `guardedSiblings`, the guarded routes beside it | medium |
| `annotation-to-missing-route` | an annotation naming a route its service does not serve | every route of that service was read | high |
| `env-not-set` | code sending to an environment value the deployment of the function running it does not set | that deployment was read whole; a value set outside the files (a secret store) is what makes it wrong | medium |

A candidate whose evidence does not hold is never listed and never silence:
`heldBack` counts it by kind, with why the first was held back (`some routes of
legacy-api were not read (route-path-dynamic)`). A route left unguarded is
ranked by deviance: guarded siblings first, then the writes it reaches (a
delete is a write), then whether a person sends it (`people`: a browser's
request, a screen's or a bot's code) rather than only another service
(`services`), then the reads; `unguarded` alone is `low`, since an internal
route only other services call is often unguarded by design. An optionality
disagreement where the receiver may go without a field the sender always sends
breaks nothing at run time, so the contracts report says it at `info` and it is
no finding; the sender leaving out a field the receiver requires stays a
warning. Warnings (an optional field one end may leave out) can outnumber every
other kind together, so "what looks broken" lists the errors and counts the
warnings: `warnings: { "contract-break": n }` and a `next` call with
`severity: "warning"`, which lists them (P395); `severity` keeps the rows at
that severity for any kind that has one. `check_contract` says per read of an
answer whether it is `guarded`, and a `missing` field read only behind such a
check is `guarded: true`. `flowatlas findings` prints the same list, `--format sarif` writes it
under `finding/<kind>` rules carrying each kind's precision, and
`--fail-on high` stops a pipeline on the defects that are nearly always right.

**Protocol, validation, settings, status and CORS mismatches (P388).** Where
flowatlas reads both sides of something the two must agree on, one side saying
what the other never does is listed the same way, gated on its evidence, each
beside a decoy in the `boundary-mismatches` fixture:

| Kind | What | Evidence | Precision |
|---|---|---|---|
| `sse-event-unhandled` | a route streams frames under an event name no listener of the browser's stream listens for: a named frame never reaches `onmessage` (MDN), only `addEventListener(name)` | every frame the route writes was read with its name (`event:` written out, Hono's `writeSSE({ event })`, the `type` of a Nest `MessageEvent`, which Nest sends as the frame's `event:`), and every listener with the name it listens for | high |
| `sse-event-never-sent` | a listener for a name the route never sends | every frame of the route was read with its name | medium |
| `bot-button-unhandled` | a button whose callback data no handler matches (a string, or a pattern tried on the data with its unread parts filled) | every handler of callback data in the project was read, and none takes every callback (`on('callback_query')`) | high |
| `bot-button-data-too-long` | callback data over the 64 bytes the bot platform's API takes (UTF-8 bytes; for a template, what is written out alone) | the platform's limit | high |
| `bot-handler-untriggered` | a handler of callback data no button the project builds sends | every button was read with its data, none built outside a function the reading draws (`bot-button-unplaced`) | medium |
| `config-name-mismatch` | a setting read with no default and set nowhere, while a name a letter or two apart is set and read nowhere | the two names | high |
| `config-not-set` | a setting read with no default (no default argument, no `??` or `\|\|`, not only tested) that none of the service's deployment files sets: environment files (examples too), compose `environment` and `env_file`, a Dockerfile's `ENV`, `serverless.yml`, a worker's `vars`, a cluster's manifests, a deployed function's environment | every deployment file of the service was read, no configuration module validates the settings with a schema that may give a default, no `envFrom` takes a config map not read; a value given outside the files (a secret store, a console) is what makes it wrong | medium |
| `config-never-read` | a name the deployment files set that no code of the service reads | every read of a setting names its key; a library reading it by itself is what makes it wrong | low |
| `status-never-answered` | a client branching on a status (`err.status === 410`, in the code that sends the request or the one caller waiting on it) the route it is joined to never answers | every failure of the route was read with its status (Nest's), nothing in the code behind it left a gap; 400, 401, 403, 405, 407, 408, 413, 415, 429 and 5xx, which a proxy or the framework may answer, are not judged | high (`404` medium) |
| `cors-credentials` | a browser request sending credentials (`withCredentials: true`, `credentials: 'include'`, or an interceptor or client default giving them to every request) to a server whose CORS answers `*` or sends no `Access-Control-Allow-Credentials: true` | the server enables CORS (Nest's `enableCors`, `NestFactory.create`'s `cors`, the `cors` middleware), read as the middleware's defaults where options are left out | high |
| `cors-header-not-allowed` | a header the request sets, or the `Content-Type` of its JSON body, that the server's `allowedHeaders` leaves out | the same; with no `allowedHeaders`, every header the browser asks for is allowed | high |
| `cors-method-not-allowed` | a verb other than GET, HEAD and POST the server's `methods` leave out | the same | high |

A client sending a field the body's class does not declare, under a validation
pipe with `forbidNonWhitelisted: true` beside `whitelist: true`, is refused
with 400: the contracts report says it as `whitelist-reject` at `error`
(`contract-break`, high), where `whitelist` alone stays `whitelist-strip`.

### Finding your way in

| Tool | Answers | Takes |
|---|---|---|
| `list_entries` | every way into the project: routes, procedures, bot commands and buttons, scheduled jobs, message handlers | `service`, `kind`, `pathPrefix`, `in` (a class, method or file: the ways in it declares, each row with `reach` and who calls it, `callers` and the first `caller` as `dead` on a class says them, the answer with `declaredBy` and `next` the `dead` call judging each), `reach` (only the rows with that reach, `dead` for the ones no code calls), `offset` |
| `find_symbol` | fuzzy search over every node, by substring or camel-case initials, and by the words of the query where no name holds it as written (P383) | `query` (required), `types`, `service`, `offset` |
| `search` | one query over routes and other ways in, channels, types of message, tables, types, gaps, what ways in can fail with, and classes, grouped by kind, with `counts` of each; a sentence, or a query no kind holds as a name, also answers `best`, the names holding its words, ranked (P383) | `query` (required), `kinds`, `limit` (10 rows per kind), `service`, `offset` |

`kind` is one of `http`, `rpc`, `event`, `cron`, `invoke`, `workflow`,
`bot_command`, `bot_callback`, `bot_event`, `scene_step`, `task` and `screen`. An `invoke` is a
deployed function called by name rather than by an address (a Lambda function,
say, as its infrastructure declares it). A `workflow` is a state machine,
reached by the name it is deployed under; its steps are `function` nodes of
kind `state`. `rpc` is a procedure — a tRPC one, say — whose
address is the dotted path its callers write, `orders.list`, rather than a verb
and a path. It has no path for `pathPrefix` to match, so a prefix leaves
procedures out; narrow them with `service` and `kind` instead.

A `screen` is a page a front end's router shows at an address (P363),
`entry:<service>:screen:/orders/:param`, the component it shows the code behind
it: so `who_calls`, `impact` and `describe_for_prompt` on a routed component
name the address it is shown at, linked or not, and `dead` answers it alive,
`routed at /orders/:param`, saying whether a link to it was read. A screen is
opened by whoever types its address as well as by the links read, so `dead`
lists none as a route nobody calls. `search` with `kinds: ["routes"]` finds a
screen by its address and by the component it shows.

`find_symbol` accepts initials: `osc` finds `OrdersService.create`. Start here
when you know roughly what something is called.

A route is found by the path a client writes, too (P377): a query holding a
`/` matches a route whose path holds it as whole segments, whatever its
parameters are called (`:orderId`, `{orderId}`, `${orderId}`, `<orderId>`,
`[orderId]`, all `:param` in the graph) and without the prefix the server adds
(`/admin/:rid/orders/:id/modify` finds `POST /api/admin/:param/orders/:param/modify`);
a verb in front (`POST /...`) keeps the routes of that verb, and a host or a
query string is no part of it. The whole path comes first, then a route ending
with it, then one holding it, after the rows matched by name.

`search` is the wider net. `kinds` is any of `routes`, `channels`, `messages`,
`tables`, `types`, `gaps`, `fails` and `classes`. Under `messages`, a type of
message on a channel is found by its value (`ORDER_SHIPPED`): each hit is the
type node, its `channel`, the first `producers` and selecting `handlers` by id,
and `unselected` where no code that runs selects it (P358). A gap's id, `gap:<service>|<file>|<reason>`,
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
| `get_flow` | one entry, or any symbol, followed through every repository it reaches, in call order, with the guard chain; with `to`, only the shortest ways to that node. At detail 2 each fact is said once (P382): an edge leaves out the `params` and `returns` the step's signature says, every step leaves out the reader's own meta (`adapter`, `controller`, `rawPath`, `source`, `package`, `receiver`, `entityType`), and a step with its own `fails` and `guards` leaves out the meta's `fails` and `access` | `entry` (required: a route said aloud, an id, `Class.method` or a short name, as `who_calls` takes it; `route` and `symbol` are read as it), `to`, `depth` (8, one more per workflow step), `maxChars` |
| `who_calls` | everything that reaches a symbol, backwards across repositories, up to every way in: the nearest callers as a tree, then each way in once under `waysIn` | `symbol` or `symbols` (required), `depth` (how many hops the tree draws, 16 at most; unset, two, one on a class or several symbols; the ways in past it are listed whatever it is), `service` |
| `impact` | every way in whose code calls a symbol, in any service: its own, those past each route on the calling side with `via`, and `maybe` rows where a chain stops at an unread call; the ways in only beyond a channel a consumer on the way takes messages from counted in `throughChannels`, one row per consumer | `symbol` (required), `channel` (list one of `throughChannels`: a channel, or a consumer for all of its), `service`, `offset` |

Asked about a class, `who_calls` and `impact` answer for every method of it
something calls (P95): calls point at methods, never at the class. Each
`who_calls` caller says the method it calls under `calls`; `impact` says how
many methods it answered for under `forMethods`.

**How one node reaches another.** With `to`, `get_flow` keeps only the shortest
ways from `entry` to that node (P229), and both may be any node, not only a way
in: `get_flow({entry: "OrdersService.findOne", to: "table:orders#orders"})`. It
is the search the page's path finder and `flowatlas path` make, along the edges
a flow walks, looking 6, 12 and then 24 steps unless `depth` says. The answer is
the tree `get_flow` always answers with, a node met twice written once, plus
`pathsFound`, `length` and `searched`. With no path it says `none` with how far
it looked, and `reverse` when `to` reaches `entry` instead, with `next` asking
the right way round.

`entry` can be named the way you would say it aloud. All three of these mean the
same route:

```
POST /orders/12345/archive
POST /orders/:param/archive
entry:orders:http:POST:/orders/:param/archive
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

`impact` is the one to ask before changing something: it answers "which ways
in, in any repository, could break", in one call (P367). It walks back from the
target past every way in it meets to the callers beyond it, with the hops that
place code in what holds it (as `from` walks): a screen that shows the
component whose method requests the route, a bot command whose handler does,
a consumer of a channel the chain publishes to. It lists only ways in that run
the target: a screen that injects a client for its other methods is not one,
and a screen's subscription is placed in the screen, not walked back onto its
channel to every route that publishes to it and every screen calling those
(P371; on the `impact-shared-client` fixture 13 rows became 4 and 10 became
2). `entries` holds them all: the
target's own ways in, and each on the calling side with `via`, the crossing
nearest the target it came through (`PATCH /orders/status (shop-api)`, a route
said aloud with its service where that is not the row's, or `channel <name>`);
`reach` on each (detail 1 is enough to say which could break). A chain that
stops before any way in, at code an unread call could reach, is a row of its
own with `reach: "maybe"`, `gap` and `via`, counted in `maybe` and in `left`
(`gaps: 1 chain stops at an unread call before any way in`). A chain that
ends at code whose name its repository writes nowhere else, in a file with no
unread call, is no way anything could break: it is counted in `unreached`
and not listed (P370; on the main fixture the web's four client methods
nothing calls and the component nothing renders left the maybe rows, and the
answer of 12 rows became 7). A link or a
navigation onto a screen or a component is no call into it, so the walk does
not go back along one, however it is stored: a `calls` or `triggers` edge with
`meta.navigates` (a `router.navigate([...])` or `navigateByUrl` in a method, a
login screen sending to the dashboard, a guard's redirect) as much as a link
(P372). Nor does it walk from what a router or a framework runs before a
screen - an Angular guard or resolver (`meta.guard`), a page's route
middleware (`meta.middleware`) - back to the screens listing it, unless the
walk reached it through its own code (it is the target, or it calls code on
the way to the target), since it runs before the screens and runs none of
their code: impact on a method a sign-in guard calls lists every screen the
guard is on, and impact on a dashboard's method lists none of them because the
guard redirects there. `entries` holds the ways in whose own code reaches the
target by calls and requests. A consumer on the way that no screen holds (a
back end's worker, a bot re-fetching on a relayed event) is not walked back
onto its channel either: what publishes there calls none of the target, so the
ways in beyond it - the publishers, and the screens and bots calling them - are
counted apart in `throughChannels`, one row per consumer (P378):
`{consumer, channels, consumers?, ways, sample, walkCut?}`, `channels` every
channel it takes messages from on the way (a name, or `{channel, type}` where
it chooses a message type), `ways` how many distinct ways in lie beyond any of
them (a route publishing on two is one), `sample` the nearest three, each
`{id, by?}`, and `consumers` how many consumers on the way take messages from
those channels where more than one does. A bot taking messages from three
channels of the same orders was three rows, each repeating the same ways in
and the same three samples; it is one. They are never complete-blocking.
`impact({symbol, channel: "<name>"})` lists one channel's ways in as
`entries`, each `via: "channel <name>"`, paged as usual, with `acrossChannel`
naming it; `channel` given a row's `consumer` (its id or name) lists the ways
in beyond every channel of that row, each once, with `acrossConsumer` naming
it. `next` offers that call first: by the channel where the first row has one,
by the consumer where it has several. Each walk beyond
a channel reads at most 1,000 nodes (`walkCut`, and with `channel` a `left`
line, where it stopped). Each row (and each sample) says `by`, the id of the
code that handles the way in on its chain to the target (P374): for a screen
the component it shows, for a route, a bot command or a consumer the method or
function it hands work to, and for a webhook whose handler is written where
the route is declared and hands the update to a class (a worker's inline
handler calling a bot's method) that class's method, so the file holding the
code a way in runs is the id's, with no search after it. A function written in
the way in's own file is routing, passed over while the chain holds other code
before it leaves the way in's own code; where it holds none, it is `by`. A
compact answer leaves `by` out where it is the target. `by` is code, not a way
in: a route's handler is where the route's work starts, and the route is the
row. A row reached through another listed one - a screen whose client
requests a route that is itself a row - names that route in `via`, and the
route says `rowsVia`, how many of the rows listed (on any page) reach the
target through it (P375): asked which ways in could break and the files
holding their code, the route's handler file is the route's, and the screens
and bots counted under it break through it. On the
`rows-name-handling-code` fixture, impact on the cancel method names the
route's handler, the bot class behind the webhook in the worker file, and the
order screen's component. On the `impact-guarded-navigation` fixture, impact on
a list method answers 5 rows where it answered 17 (1,437 characters compact,
from 2,766) with the channel's four ways in counted, and on an acknowledge
method 3 where it answered 6. It is bounded by 4,000 nodes; `entriesByService`,
`reachedByService` and `servicesWithoutEntry` still name the services whose
chains run into this one without an entry point of their own. At `detail` 2,
a failure on an entry whose `at` is the target, and a `file` the id beside it
holds, are left out of a compact answer. With no way in it says `entriesNone`
("nothing in the graph reaches this from a way in; the callers may be behind a
gap", or "nothing reaches this"), and `next` names a deeper `who_calls`, the
service's `cant_follow` and a gap search on the file. A walk that stopped at
its own limit (4,000 nodes) says so in `truncated`.

**who_calls up to the ways in (P376).** Asked without `depth`, `who_calls`
answers "who calls this, up to the ways in" in one call. `callers` is the tree
of the nearest callers, two hops (one on a class or on several symbols: each
method's or symbol's direct callers); past it the chains are not drawn, so the
answer does not grow with how far the ways in are. `waysIn` lists every way in
the walk reaches, each once, nearest first: its row with `reach`, `hops` (how
many steps back it is) and `by` (the code that handles it on the chain, as
impact says it). The walk is impact's (`waysIn`, P367 and P372): back past
every way in to the callers beyond it (the gateway route that requests the
route, the screen whose component requests that), never along a navigation
or a guard's redirect, and never from a consumer back across its channel: the
ways in only past a channel are counted under `throughChannels`, one row per
consumer as impact says them but with no `sample` (`{consumer, channels,
consumers?, ways, walkCut?}`, and `reaches` on a class or several symbols):
who calls the code is the question, and what lies past a channel calls none of
it, so it is a count, and `next` names the `impact({symbol, channel})` call
that lists them (P378). A chain that ends
before any way in where an unread call could reach it is a `maybe` row (with
`gap` or `behind`), one no unread call could reach is counted in `unreached`,
and with no way in at all `waysInNone` says why. The walk reads at most 4,000
nodes per symbol and 20,000 for all asked together; past either, `left` says
so. `next` never names a deeper `who_calls`: the answer reached the ways in.

On a class, `waysIn` says which methods each way in reaches in `reaches` (by
the method's own name, as `calls` on its callers says it), and asked several
`symbols`, each answer under `answers` holds its target and direct callers
while `waysIn` is said once for all of them, `reaches` naming the symbols
(by label) a way in reaches where it reaches only some. Each answer's direct
callers are the shape asked for, not a cut: the call is complete where the
walk finished, and `next` never names `who_calls` on one of the symbols again
(P379). On the
`callers-walked-to-ways-in` fixture, `who_calls` on a method whose report
route is five calls down answers in one call of 2,828 characters where a depth
of 3 took three calls and 11,993, and on its class in 2,926 where it took three
and 20,854.

**Where a method's requests land (P377).** An answer about one method says
where the requests it sends land: `who_calls`' `target`, each `find_symbol`
match, and `get_source`'s answer beside the code, in one list, `requests`
(P393: it was three keys a model could confuse, `requests`,
`requestsUnjoined` and `requestsMore`): each route a request is joined to,
`{route, by}`, `by` the code handling the route (the controller method); each
request joined to no route, as written, `{unjoined: "POST
${apiUrl}/admin/:param/catalog/export"}`; past eight, a last row `{more: 3}`
counting the rest. The requests are the ones the method sends
itself and the ones the code it calls in its own service sends for it (a
helper of its class, a base class's verb helper, a client wrapper function,
two calls deep at most); a call into a class its class injects is that
class's request, so a screen's method calling a client says none. Code that
sends nothing says neither. `get_flow` takes any symbol the way `who_calls`
does (an id, `Class.method`, a short name that is the only best match, the
candidates when several nodes share it, each as the call to make), and with
nothing near says so and names `find_symbol`, never an empty list of
suggestions.

With `depth`, `who_calls` draws the tree breadth first to that depth (16 at
most) and still lists every way in past it under `waysIn` (P379): the depth is
how far the tree is drawn, never a cut, so it is not said in `left`, `truncated`
or `frontier`, and `next` never names the call again. Asked several `symbols`
with a depth, each answer draws its tree to it and `waysIn` is said once for
all, as without. Only `maxNodes` cuts the tree: `truncated`, `stoppedBy:
["maxNodes"]` and a `left` line. Before, a depth answered the tree alone: a pilot
asking ten routes of one controller with `depth` was handed ten trees, each
`complete: false` with a depth line in `left`, no `waysIn`, and `next` asking
`who_calls` again on each; it went on to grep. A caller the graph holds no node
for is a `missing` row.
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
  (`throw`, `guard`, `pipe`, `interceptor`). `assumed: true` is a status nothing on the path
  writes, such as the framework's 500 for an error it does not know;
  `declared` is the status the error class states where no filter maps it. At
  `detail >= 2` each entry adds `places: [{ at, loc, source }]`. A throw whose
  exception a helper chooses at run time (`throw toHttpError(check)`) is named
  after the helper and adds `via: 'helper'` and `chosenFrom: [{ exception,
  status?, assumed? }]`, what the helper's table can give; `status` is there
  only when every choice agrees, and `family: 'auth'` marks a helper whose
  answer could not be read that refuses a check of who is asking.
  `describe_for_prompt` writes it as `toHttpError (401 | 403 | 423)` with the
  classes it is chosen from. Read for NestJS. With an observed file, each row
  gains **`seen: n`**, the requests that answered a status it declares in the
  window (absent when none did).
- **`failures`** on the root entry, with an observed file that saw it answer
  statuses (P106): `{ hits, window, undeclared: [{ status, count, share,
  expected?, maybe? }], declaredNeverSeen: [{ status?, exception, at, loc? }],
  tooFewHits? }`. `undeclared` is each status from 400 up that no failure of
  the root declares, the ones no reason explains first, then 5xx, then the
  most common; `expected` says why the framework answers it anyway (the
  router's 404 and 405, a 401 or 403 from a check in front of it, a 400 for a
  body it cannot read). `declaredNeverSeen` is each declared failure no
  request answered, said only of a way in hit at least 20 times in the
  window; below that, `tooFewHits: true`. An `assumed` status never seen is
  not listed: the code never declared it. `describe_for_prompt` carries the
  same `failures` beside its text for an entry.
- **Guards** in front of a NestJS route carry `where` (`global`, `module`,
  `controller`, `route`), `via` (`APP_GUARD in AuthModule.forRoot`), and
  `skippedBy` when an opt-out decorator switches one off; the entry carries
  `optOuts`.
- **`observed: n`** on a row real traffic went through, after
  `flowatlas observe` has read a trace file: the count on the join into it, or
  the entry's hits. Absent when nothing saw it. Beside it, **`p95`** (in
  milliseconds) and **`errorRate`** (the error flag or a 5xx, over the
  requests whose outcome is known) where the file measured them.
- **`seenAmbiguous: n`** on a row that requests could have been, or whose
  join into it they could have run, but fit other places as well: those are
  counted on none of them, so `observed` never spreads one request over
  guesses.
- **`confirmedBy: "traffic"`** beside `edge.confidence: "heuristic"` on a row
  joined by a best guess that traffic went through in the window (P110): the
  join itself was seen. Read beside the confidence, never written into it; the
  graph on disk does not change, and no edge becomes `runtime`.
- **`baseUrlFrom`** and **`baseUrl`** on a request joined by a value read from a
  repository's own files, the code's own fallback or the setting's name, saying
  where the value came from.

`who_calls` rows carry `observed: n`, `p95`, `errorRate`, `seenAmbiguous: n`
and `confirmedBy` the same way. When the observed file holds a sample request of an entry, the
entry's hints in `get_flow` and `list_entries` name `trace_for` second.

### What ran

| Tool | Answers | Takes |
|---|---|---|
| `hot_paths` | the ways in real traffic used most, busiest first, each with its p50, p95, max and error rate and the joins it reached most | `service`, `limit` (10), `joins` (5) |
| `slow_steps` | the joins and methods real traffic was slowest on, each with its count, p50, p95, max, error rate and, for a join, `measuredAt` (`caller` or `callee`) | `entry` (only what it reaches), `service`, `by` (`p95`, `max`, `p50`), `minCount` (5), `limit` (10) |
| `trace_for` | one slow and one failing request of an entry, as trees of `{ id?, label, service?, kind, ms?, status?, error?, children }`, `id` the node each span was credited to | `entry` (required: an id or a route said aloud), `maxNodes` (60, per tree) |
| `never_seen` | what the code runs and traffic never touched in the window - ways in (every kind), channels, and the methods ways in reach, in services the window holds a span of - strong first, each `{ id, type, kind?, service, loc?, window, reachableFrom, neighbours: { seen, of, most }, confidence }`; the answer carries the `window` (`{ since?, from, to, label, short? }`) and `notes`, one per service with no span at all | `since` (`7d`; all the file holds without it), `service`, `kind` (a node type or an entry kind), `confidence` (`strong`, `weak`), `limit` (20) |
| `undeclared_failures` | the ways in whose traffic answered a status no failure in their code declares, worst first (requests answering a 5xx no reason explains, then any status no reason explains, then the largest share), each `{ entry, label, service, hits, undeclared, declaredNeverSeen?, tooFewHits?, next }` with `next` naming `trace_for` for a failing request and `get_source` on the handler; the answer carries the `window` | `service`, `minCount` (1, requests per status), `minHits` (20, the floor for "never seen"), `limit` (20) |

They answer from the observed file `flowatlas observe` writes beside the
graph (see the [CLI guide](CLI.md#flowatlas-observe-file)); with none they
say so. A row names only places the graph still has, so a file older than
the last build answers for what is still there. `slow_steps` leaves out a call
site whose join is listed, since both are timed on the same span. A
`trace_for` tree carries no trace or span id; the failing request is shown
once when it is also the slowest, and an entry with no sample says what would
give it one. Each answer is cut at its `limit` or `maxNodes` and says so, and
`next` chains them: `hot_paths` → `slow_steps({entry})` → `trace_for({entry})`
→ `get_source` on a slow step, and `undeclared_failures` → `trace_for({entry})`
→ `get_source` on the handler. Only statuses and counts are compared: the
observed file keeps no exception text, so which exception caused an
undeclared 500 is never guessed.

`never_seen` (P110) is evidence with a confidence, never a verdict: traffic is
what was exercised, by whom, in which environment. A row is `strong` when the
file holds the whole window asked for and one of its siblings - a way in of
the same service and kind, a method of the same class, a channel of the same
service - was seen at least 20 times; otherwise the service may simply not
have been exercised there, and it is `weak`. A handler counts as seen when the
way in it handles was hit; a method is asked about only where the service's
spans name methods at all. `since` cuts the file's hours at read time, ending
where the file does, so `7d` and `30d` differ without the traces at hand; a
window longer than the file holds says `short: true` and every row is `weak`.
`reachableFrom` is `code` when something in the graph reaches the node and
`outside` when only something outside could. `next` names `dead({id})` and
`get_flow({entry})` (or `who_calls`) on the first row.

### Messages and types

| Tool | Answers | Takes |
|---|---|---|
| `who_emits` | everything that publishes on a channel, across every repository; with `type`, what publishes that type of message on it; with `field`, only the publishes that send that field. A message type given as the channel (`ORDER_READY`) is answered on the channel carrying it, as with `type`, `carriedBy` naming it; on several, one answer each under `answers` (at most three) (P393) | `channel` (required), `type`, `field`, `service`, `offset` |
| `who_consumes` | everything that handles messages from it; empty means nothing does; with `type`, the code that selects that type of message, or why nothing does; with `field`, only the handlers that read that field, each with where; a message type given as the channel, as `who_emits` takes it (P393) | `channel` (required), `type`, `field`, `service`, `offset` |
| `get_type` | the structure of a type, with what it refers to expanded to a depth | `type` (required), `depth` |
| `type_usage` | every way in, crossing, channel and call that takes or returns a type, and the types holding it | `type` (required), `service`, `offset` |
| `check_contract` | what one side of a crossing sends against what the other expects; on an entry, the fields of the body each piece of code on its path reads, the fields of its answer each client reads (`answer`), and what traffic carried into it against its code; on a channel or one type of message, the fields read and not sent and sent and never read | `edge` (a crossing, an entry id or a route said aloud), or `from` and `to`, or `channel` and `type`; `field` |
| `get_spec` | a service's routes as the OpenAPI 3.1 document `flowatlas spec` writes, or its channel ends as AsyncAPI 3.0, as JSON text; with `path`, one operation and only the schemas it uses (P118) | `service` (required), `kind`, `path`, `maxChars` |

A channel that carries several kinds of message told apart by a field
(`type`, else `kind`, `eventType` or `event`) has a node per type (P358):
`channel:<name>#<value>`, of kind `message_type`. A publish whose payload
fixes the type emits onto it; a handler a consumer's `switch`, `if`, early
return, record of handlers or decorator chooses for it consumes from it, one
call deep. Without `type`, `who_emits` and `who_consumes` answer as before and
add `types`, the values read on the channel. With `type` (or the type node's
id as `channel`), `who_consumes` lists the selecting handlers, each with
`selectedIn` (the consumer that chose), `via` and, where nothing builds its
class, `unreached`; where no code that runs selects the type it says
`unselected` - which consumers choose other types, which pass every type on
without choosing, which were not read - and `sureness`: `sure` only when every
consumer of the channel was read and chooses by type. `who_emits` with `type`
lists the publishes of it and, where there are none, `maybe`: publishes on the
channel whose type was not read. A type nobody reads answers with the types
that are. `dead` and `impact` take a type node like any channel; a type
published on a channel whose consumers choose by type, and chosen by none, is
the finding `message-type-unselected`.

A handler that chooses no type in its body is still read for the types it
takes (P369): the code calling it under a `case` or an `if` on the message it
hands it (`via` that choice, the caller's file in `selects`), and failing
that the declared type of its parameter where its discriminator is a literal
(`via: parameter`); where the two differ the caller's choice is drawn and a
`message-type-differs` row says so.

A branch's handler is the first call of the repository's own it makes that is
handed the message, else the first such call, else the branch itself; a call
into another class counts only when it is handed the message itself (P374).
A branch showing a toast with one of the message's fields
(`this.toast.showInfo(event.text)`) is handled by the function it is written
in, never by the toast, whose other callers would make it look reached. A
consumer whose subscription is made in code - the method calling `subscribe`
(`subscriptions`), or, for a handler a dispatch chose, its chooser's - never
runs where that method's class is built by nothing (no module registers it,
nothing injects or imports it) and nothing outside the class calls it: `dead`
says so (`nothing builds OrderNotices and nothing outside it calls
OrderNotices.initialize, where the subscription is made`), its rows say
`reach: "dead"` and `from: "none"`, its selections are `unreached`, and what
publishes to its channel does not reach it. A choice handing the message to a
function of the repository's own that chooses again is followed into it, and
a handler written in place - a subscription's callback, a stream listener in
a hook - is read where it is written. A subscriber to every channel of a
project's own bus at once (`bus.all().subscribe(...)`) is a consumer of every
channel a publish through that bus in its service writes to, narrowed by what
its callback and the method it hands on to choose; so `who_consumes` with a
type and `search` on the type name it.

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
`"from -http_calls-> to"`. It takes a question as an agent writes it (P382):
`route` or `entry` is read as `edge` (the server reads the names agents reach
for as each tool's own input where that is not given too: `route` and
`symbol` for `get_flow`'s `entry`, `id` for `get_source`'s `symbol`, `route`
for `who_calls` and `impact`, `symbol` for `dead`'s `id` and `symbols` for its `ids`, `id` for `get_type`'s `type`; they are not listed, so the upfront listing pays
nothing for them); one end alone (`to: entry` or `from: entry`) is the entry;
a handler alone answers the error with `check_contract` on the route it
handles; and a type of message given as `channel` (`HELP_REQUESTED`, in any
case) is answered on the channel carrying it, or, where several carry it, on
each in one answer, `{ type, carriedBy, answers, complete }`. An input that
names nothing answers an error whose `next` holds the exact calls to make:
the nearest ways in or channels, the channels there are, the calls into or
out of the end given, or a `search` for the route by its path. Its `findings`, when the contracts checker is
installed (`flowatlas mcp` installs it), are `{ severity, kind, direction,
field, expected, actual, message, ignored? }`; the crossing is the answer's
`edge`.

**Traffic as the third side (P113).** When `flowatlas observe --shapes` left
body shapes beside the database, an answer about a crossing into an entry
carries `traffic`: what real requests and answers carried, compared with the
route's declared body type and its declared answer (or, when the route
declares none it can be read through, the type the caller expects back).
`traffic` is `{ samples, window, against?: { request?, response? }, request?:
diff[], responses?: { [status]: diff[] }, unchecked?: ["response 500:
status-not-declared", ...] }`, each diff `{ severity, kind, field, expected,
actual, seenIn, of, message }`: `seenIn` bodies carried the field, of `of`
that could have. Traffic is never an `error` on its own; `declared_never_sent`
(information) is a declared optional field no body of at least 50 carried.
Given an entry id as `edge` (`check_contract({edge: "entry:…"})`), it answers
`{ entry, traffic | note, callers }` with `next` checking each call into it,
and `get_flow` on an entry whose traffic differs puts that call second in its
`next`. Only key names and JSON types are ever kept of a body, never a value.

Given two service names as `from` and `to` (and no node by either name, which
would win), it lists every crossing from one into the other: each request
(`http_calls`, `hits`) that reaches an entry of the other, and each publish
(`emits`) onto a channel the other handles (`via` names the channel). Each
crossing is `{ from, to, type, via?, status, check }`, worst `status` first,
`check` the call that checks it in full; `byStatus` counts them and `maxNodes`
bounds the list. With none it says so, and how many go the other way.

**Fields read and sent (P368).** The reading writes, on the handler of every
HTTP route and of every consumer that chooses for itself, and on every guard,
interceptor, pipe and middleware a route runs first, which fields of what it
is handed it reads: `meta.fieldsRead`, rows `{ field, in?, line, when?, sureness? }`
(`field` dotted from the payload, `in` the function it is read in where that
is not the node's own, `when` the types of message a `switch`, an `if` or an
early return on the discriminator reads it under), and `meta.fieldsUnread`,
each use it could not follow with why: the whole value spread, put inside
another, handed to a function outside the repository (`handed to
this.logger.log`), indexed by a variable, its keys walked, gathered by a rest
pattern, or a walk cut by its bounds (4 calls deep, 30 functions, 80 reads).
It follows a member read (`evt.label`, `evt?.label`, `evt['label']`), a
destructuring, a local that is the value again (`const e = raw as Evt`), the
value handed to a function of the repository, and a request's body however
the code reaches it: `@Body()`, `@Body('x')`, `@Payload()`, `@MessageBody()`,
`@Req()`, `req.body.x`, `ctx.request.body.x`, `await c.req.json()`,
`c.req.valid('json')`, and a guard's `context.switchToHttp().getRequest()`. A
value only compared, tested or returned is not a read. A name holding a field
already read is not read again: only a key past it is. A key the code holds in
a local or an option is read where the reading settles it to a string (P374):
a `const`, a parameter's default, or a member of an object literal written as
the default behind `??` or `||` (`const source = options.actsAs ?? { in:
'body', name: 'userRef' }; bag?.[source.name]`), the row then saying
`sureness: "default"`, since the options may name another; and a local
assigned the value in one branch and something else in another (`bag =
req.params` / `bag = req.query` / `bag = req.body`) holds it for every read of
it, so the body's branch reads `userRef`. `check_contract`'s `reads` carry
`sureness`, and each `left` line names the method or function a use the
reading could not follow is in (`unsure: guard ClientGuard.suppliedId: ...`),
never only the class a guard's rows are written on.

`who_consumes` with `field` keeps the handlers that read it, under `type` where
one is asked (a read inside another type's choice is not this type's; a
handler a dispatch chose reads what its chooser reads under that type), each
with `readIn: [{ id, line }]`; a handler not read for fields, or one that hands
the message where the reading could not follow, is said in `left`.
`who_emits` with `field` keeps the publishes whose payload's shape holds it,
narrowed to the member of a union whose discriminator is the type asked. At
`detail: 2`, without `field`, each consumer row says `reads` and each publish
`sends`. `search` finds a field by its name under `fields`: one row per type
of message, channel or route it crosses, `{ id, label, read, sent }`, whose
`next` is the `who_consumes` or `check_contract` that names the code.

`check_contract` given a route (an entry id, or said aloud: `PATCH
/orders/:id/cancel`) answers `reads`, every field of the body the code on the
request's path reads, `{ field, id, line, layer }`, the layer `guard`,
`interceptor`, `pipe`, `middleware` or `handler`, so a body the handler
ignores and a guard reads names the guard; `field` keeps one. Given a
`channel` (and a `type`), it lists the `producers` with what each `sends`, the
`consumers` with what each `reads`, `missing` (a field a handler reads and a
publish does not send, at the first place it is read, with `notSentBy` where
only some publishes leave it out) and `unused` (sent, read by nothing, with
`sentBy`); without `type` a channel that carries types is compared type by
type. On a request edge into an entry, `fields` holds the same two lists for
the body it sends against what the route's path reads.

**Fields of an answer each client reads (P391).** The front-end readers write,
on every request the browser makes, which fields of the answer the code that
asked for it reads: `meta.answerRead`, rows `{ field, in, line, file? }`
(`field` dotted from the answer, a list's element's fields at the list's own
path; `in` the method, function or component it is read in; `file` the
template where the read is written in one), and `meta.answerUnread`, each use
it could not follow with why. The answer is followed from the call that makes
the request: through `await`, `then`, `json()` (the platform's `fetch`, ky),
`data` (axios), `body` (Angular's `observe: 'response'`), `subscribe`, `pipe`
with the operators that pass it on, look at it or map it (`map`, `switchMap`,
`pluck`), `firstValueFrom` and `toSignal`; handed back from a client method to
the next call of the wrappers the request was followed out through, else to
every caller (20 at most, 4 functions out); into a component's member
(`this.order = order`, a signal's `set`, a subject's `next`, an observable held
as `orders$`); from the member into the component's template (`{{ order.total
}}`, `@for` and `*ngFor`, the async pipe, `@if (…; as x)`, `*ngIf="… as x"`,
`@let`), the member's reads in the class's code, a method the template hands it
to (`(click)="email(order)"`) and a child component an element binds it to
(`[order]="order"`, by the child's selector); into a React state through its
setter, the props of a component it is bound to (`<OrderRow order={o} />`),
and the `data` of `useQuery`, `useSuspenseQuery`, `useInfiniteQuery` and
`useSWR`. Inside code it is P368's walk, which here also follows a list
element by element (`map`, `filter`, `find`, `forEach`, `for…of`), reads
`.length` and a string's methods as no field, and takes `x ?? []` and `?:`
branches as the value. A use it cannot follow is said: an operator not known,
the answer gathered with others (`forkJoin`, `Promise.all`), handed to a
function outside the repository (`handed to JSON.stringify`), bound to an
element of a component not read, a request made through a client whose answer
is not followed (described clients, XHR, jQuery, superagent: no `answerRead`
at all).

`check_contract` given a route answers `answer` beside `reads`: `type`, what
its handler declares it answers; `reads`, every field of it a client reads,
`{ field, id, line, file?, call? }` (`call` the request, where the route has
several callers), 40 at most; `missing`, a field a client reads that the
answer never holds, at the first place it is read; `unused`, a field answered
and read by no client, said only where every caller's answer was read and none
hands it on. `field` keeps the reads of one field: the code that breaks if it
changes, each read's component or method naming the screen it is on. A request
whose answer was not read, a server-side caller among them, is said in
`left`, as is each use not followed. On a request edge into a route, `answer`
holds the same for that one request.

`get_spec` writes the document from the database as it stands, through the
wire rules, so a schema says what goes over the wire; a shape it could not read
is `{}` with `x-flowatlas-unread` and the reason, and `unread` and `omitted`
count them. `path` takes a route as a request would say it (`GET /orders/{id}`
or `get /orders/:id`; a path alone answers every verb of it), a channel address
(`order.created`), or an operation's key (`send order.created`); without
`kind` it looks in both documents. The text is cut at `maxChars` (12,000) and
says `truncated` with how much there was; a cut whole document lists its
`operations` and `next` asks for one. `describe_for_prompt` with `withSpec: true`
adds the route's or channel end's fragment as an *OpenAPI* (or *AsyncAPI*)
section in a fenced JSON block.

### Why a flow stops

| Tool | Answers | Takes |
|---|---|---|
| `cant_follow` | every step the reading could not follow, grouped by cause and then by the package it points into, with a few places each and the id of the method each is written in | `service`, `cause`, `package`, `top`, `samples`, `offset` |
| `test_pattern` | a draft extraction pattern checked before it is suggested: each rule refused with the part named, or its own tests run, and what it draws from the code with the holes it filled | `yaml` (required), `code`, `service` |

With an observed file beside the graph (P110), what traffic reached and no
reader drew stands under its own cause, `seen-not-in-code`: one row per
service and kind of span `observe` matched to nothing, file-less, so the
cause lists `seen` groups in place of packages, each `{ service?, kind,
count, places, lastSeen, names: [{ name, count, lastSeen }], more?, next }`,
`next` the call that looks for it (`find_symbol` for a method, `list_entries`
for a route, `search` for a destination, a table or anything else). A blind
spot is a question, never an edge; the rows go when a build reads them.
A service's blind spots are one check, `gap:<service>||seen-not-in-code`, which
`describe_for_prompt` writes with *How to close it* as the page does (P144):
the link line, naming the repository probably missing when the service is one
no configured service is, then finding and describing what it reached. Such a
service's traffic is also one kind of evidence for `start_here`'s
`missingRepos`, beside what the code says; weak alone, as in `doctor --missing`.

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

A cause whose rows are calls on a receiver nothing types, or a channel a
wrapper hides (`call-dynamic-receiver`, `channel-dynamic`, and the other reasons
`flowatlas patterns suggest` reads), also gets a `test_pattern` call in `next`,
with a starter rule for its first place: the method that place calls, the kind
its name suggests, and `TODO` for the receiver's type. `test_pattern` runs rules
written as YAML - one rule or a list, as a pattern file holds them - by the
reader the build runs, in memory, and is the same tester `flowatlas patterns
test` is (P121): with `code`, what each rule draws from it (`producer on
channel:book.added`), the rows it leaves and what each hole caught, or how far
the pattern got (`stoppedAt`); with `service`, the code is typed in that
service's own program. At most ten rules and ten tests a rule are answered. It
runs only under `flowatlas mcp`, which hands the server the readers; a server
started without them says so.

### What a branch changed

| Tool | Answers | Takes |
|---|---|---|
| `what_changed` | the last `flowatlas diff`, read back: nodes, edges and types added, removed or changed, the ways in that reach them, and the contracts the branch broke; with `verdict`, whether it is safe to merge and why. `file: "check.prod.json"` reads what `flowatlas check --env prod` compared instead (the deployed side as base) and adds `check: { environment, verdict, because }` | `service`, `file`, `verdict`, `offset` |

| `check_change` | the working tree against the built graph, before anything is committed (P387): the verdict and `because` as `what_changed({verdict: true})` gives them, then calls and channel ends that lost what they joined (`vanishedTargets`), new contract errors (`breaks`), new findings and gaps, the ways in the changed code reaches (`retest`), `read` (the services read again), `ms`, and `complete: false` with `left` naming what was not checked; with `base`, that git ref in place of the built graph | `base`, `services`, `timeoutSeconds`, `service`, `offset` |

`check_change` reads again only the services whose files changed since the
build - a file the build read that changed or went, against the stamps it wrote
beside the graph, or a new file git lists - and takes every other one from the
built graph on both sides, so an edit to one service is compared in the time
that service takes to read. `services` names the ones to read instead; with
`base` they are those that differ from the ref. The command line runs it in a
process of its own (`flowatlas check-change`) and stops it at `timeoutSeconds`
(120 unless asked, at most 600), answering an error that says so and how to ask
again; a later page reads the same check rather than building again. A service
the build wrote no stamps for is read whole, and one not on disk is the built
graph's on both sides, each said under `left`. The field a message or a body
sends under another name is said by the edit hook as it is made; it is not yet
a contract break here.

`what_changed` reads the `diff.json` that `flowatlas diff <base-ref>` writes rather than
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
format 2 has no flows; the verdict does not read them.

**The verdict.** `what_changed({verdict: true})` adds `verdict` - `safe`,
`unsafe` or `unknown` - and `because`, one sentence per reason, unsafe ones
first. The rule is fixed, so a reviewer can disagree with a reason rather than
with a score:

- **unsafe**: a new contract error; a new violation of an architecture rule at
  `error` along edges that are not guesses (P114); a call whose target went (it joined a
  route on the base side and joins nothing now), or a channel left with no
  producer or no consumer; a removed way in that another service still calls.
- **unknown**: a service the base ref could not be read for (read from its
  working tree on both sides, so reported unchanged without being compared); a
  new gap on a path from a changed node back to a way in, which the reading
  cannot see past; a `diff.json` older than format 4, which holds no rule
  violations (format 1 no gap rows either: "rerun flowatlas diff for new gaps,
  lost joins and rule violations"). The verdict does not read flows, so their
  absence decides nothing.
- **safe** otherwise.

Beside it: `newGaps` (gap ids the head has and the base does not, each with
the method it is in, `onChangedPath: true` where it makes the verdict
unknown, and `next`; a gap id the base held too is listed when it gained
sites, at the first new one, with `kept` the sites the base already had), `vanishedTargets` (`{ caller, target, now }`, `now` what
the head side says instead, such as `target-route-not-found`), `retest` (the
ways in that reach a change, ranked by how many changed nodes each reaches and
then by `observed` traffic; it takes the place of `entries`) and `newFindings`
(likely N+1s, unguarded routes and contract warnings the branch introduced,
which never decide the verdict). One `offset` pages these with the rest.
`next` traces the first way in to retest, checks the first break, reads the
method of the first new gap and asks who calls the first caller that lost its
target.

### Pages that describe a node

Where `flowatlas docs` has indexed doc blocks (its `docs.json`, beside the
database), `get_flow`, `describe_for_prompt` and `impact` carry `docs` on an
answer about a node a block names: `[{ file, line, kind, state }]`, `file`
relative to the configuration, `kind` `flow`, `channel`, `symbol` or `ref`. The
state is worked out when the question is asked, against the graph as it is
then, not when the index was written: `ok`, `changed` (the flow the block
describes gained or lost a step since it was written), `gone` or `ambiguous`.
An agent changing that flow learns there is a page to update with it, and
which line; `flowatlas docs --write` regenerates it. `start_here` says
`staleDocs`, how many blocks no longer say what the graph says (under
`service`, the blocks about its nodes). Without an index, neither appears. No
tool is added for it.

**Pages that mention a node, and comments that say why** (P234). A page needs
no block to be found: a decision record or a README that names a node in code -
`` `POST /orders` ``, `` `order.created` ``, `` `OrdersService.create` `` - is
listed in the same `docs`, with `kind: "mention"` and the `heading` above it, at
most five per answer; a doc comment's `@see docs/adr/0007.md` is `kind: "see"`.
A comment above a declaration that starts with `WHY:`, `NOTE:`, `DECISION:`,
`HACK:` or `SEE:` is kept on its node and written by `describe_for_prompt` under
**Why**, in the author's words. Only exact names are linked, by the rules a
block's id is resolved by; a word in prose never is.

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
| `flowatlas://overview` | the project's overview as `flowatlas report` prints it: services, what crosses between them, what most depends on, what is worth a second look, what was not read, and questions to ask |
| `flowatlas://services/{name}` | one service: what `start_here` says of it, its crossings to and from every other service with how each checks, and its top findings |

Resources read the same database as the tools: without one, a service reads as
the same `graph.db not found … run flowatlas build` the tools answer.

### Source

| Tool | Answers | Takes |
|---|---|---|
| `get_source` | the code of one symbol, by id or by name, as plain text; a class as its skeleton | `symbol` (required), `context`, `fromLine`, `maxLines`, `whole` |

Compact, the answer is the code as plain text (P382): a first line `// <id>
<file>:<line>-<endLine>`, the code, then `// next: …` and any other field on
lines of their own, with no JSON string to escape it into. A class read from
its start answers its skeleton: its decorators, its declaration and each
member's first lines, every line with its number in the file, each body folded
to `{ … }` on the line that opens it (`skeleton: true` in the document);
`whole: true` gives the class's code, `fromLine` reads on from a line as
before, and `next` starts with the `whole` call. `verbose: true` answers the
JSON document (`id`, `file`, `line`, `endLine`, `code`, `skeleton?`,
`truncated?`, `requests?`, `next`), as before; it lists no output schema, since
a client reads a plain answer only where no structured content comes with it.

At most `maxLines` lines (400, the most there is) per answer. A declaration
longer than that says `truncated: "declaration continues past line N; ask with
fromLine N+1"`, and `next` starts with that call; `context` widens only the
first and the last page. The only tool that returns source, deliberately. A trace never drags in the body
of every method along it: the agent asks the graph which name to look at, then
asks for that one name.

---

## Using it well

The shape that works is **one call per question** (P382): the tool the
question needs, with the name as you have it. `who_calls`, `impact`,
`get_flow`, `get_source` and `check_contract` each take an id, a
`Class.method` or a route said aloud, and `service` picks among same-named
ones; a lookup first (`find_symbol`, then the question's own tool) is a turn
for nothing. Before changing a route, handler, body type or message payload,
ask `impact` first. Read code (`get_source`) only for the step an answer
points at: a class answers its skeleton, a method its code. The graph is
cheap; source is not.

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

**When the graph is behind.** An answer whose files changed since the build says
so in `stale`: how many of the files it cites changed, the first of them, when
the graph was built, and `fix: "run flowatlas build"`. A fresh answer has no
`stale`, so it costs nothing until it matters. `start_here` says under `moved`
which checkouts are on another commit or branch than the one the graph was built
on (`web: built on main@4f1c2a9, now feature-x@91be03d`).

Three ways to keep it from falling behind, from least to most automatic:

- `flowatlas build --watch` while you work: rebuilds on every save.
- `flowatlas hook install`: git hooks that rebuild in the background after a
  checkout, a merge or a rebase ([CLI](CLI.md#flowatlas-hook-install--status--remove)).
- `"mcp": { "pull": "on-start" }` with a `remote` ([one graph for the team](team.md)):
  the server pulls the team's graph when it starts; `start_here` says `pulled`,
  with where it came from and when it was built.
- `"mcp": { "rebuild": "on-change" }` in the configuration: an answer that finds
  its files changed starts a background build, and says `rebuilding: true` in its
  `stale`; the server reopens the new graph when it is written. Off by default,
  since work that starts on its own is a surprise unless somebody chose it.

- `"log": { "questions": true }` in the configuration, or
  `FLOWATLAS_LOG_QUESTIONS=1`: every tool call adds a line to
  `<output>/questions.jsonl` with the tool, the ids it was given, whether they
  resolved, the size of the answer and the gaps on it. Ids and counts only,
  kept on this machine; `flowatlas stats --questions` summarises it and
  `doctor --unresolved` puts the gaps asked about first
  ([the question log](CLI.md#the-question-log)).

A rebuild with nothing moved reads only what changed, so it is a fraction of a
cold build; the [README](../README.md#measured-on-the-demo-project) has both
timed on the demo project. The tools listed follow too: a build that first reads
a channel lists the channel tools, and `flowatlas observe` the run-time ones
([which tools appear when](#which-tools-appear-when)).

---

## When something is wrong

**The client does not list `flowatlas`.** Check that `.mcp.json` is at the root of
the repository you actually opened, and that `flowatlas --version` runs in the
same shell the client starts from.

**It lists the server but every call fails.** The graph has not been built, or
`--config` points at a configuration whose `output` directory is empty. Run
`flowatlas build` and check that `.flowatlas/graph.db` exists.

**A tool this page names is not listed.** The project cannot answer it yet:
`start_here` says when it appears under `hidden` (`flowatlas observe` for the
run-time tools, `rules` in the configuration for `check_rules`). A client that
does not act on `tools/list_changed` shows a new tool only after it reconnects.
To list every tool anyway, add `--all-tools` to the command, or set
`"mcp": { "tools": "all" }` in the configuration.

**The server will not start, naming a tool.** The configuration's
`mcp.include` or `mcp.exclude` names a tool there is none of; the message names
the nearest one.

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
