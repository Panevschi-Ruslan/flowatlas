# The graph server

An agent sitting in one repository can only read that repository. flowatlas serves
the whole project's graph over the Model Context Protocol, so a session in the
frontend can answer a question about the service three repositories away without
opening it, and without reading its source.

Ten tools. Only one of them returns code.

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

## The ten tools

Every tool takes `detail` (0 to 3, how much of each node comes back) and
`maxNodes` (the ceiling on the answer), except `get_source`, which takes
`context` and a line limit instead. Answers are bounded and say when they
were cut, rather than filling a context window.

### Finding your way in

| Tool | Answers | Takes |
|---|---|---|
| `list_entries` | every way into the project: routes, bot commands, scheduled jobs, message handlers | `service`, `kind`, `pathPrefix` |
| `find_symbol` | fuzzy search over every node, by substring or camel-case initials | `query` (required), `types`, `service` |

`find_symbol` accepts initials: `osc` finds `OrdersService.create`. Start here
when you know roughly what something is called.

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

`impact` is the one to ask before changing something: it answers "what would
have to be retested", including the services whose chains run into this one
without an entry point of their own.

### Messages and types

| Tool | Answers | Takes |
|---|---|---|
| `who_emits` | everything that publishes on a channel, across every repository | `channel` (required) |
| `who_consumes` | everything that handles messages from it; empty means nothing does | `channel` (required) |
| `get_type` | the structure of a type, with what it refers to expanded to a depth | `type` (required), `depth` |
| `check_contract` | what one side of a crossing sends against what the other expects | `edge`, or `from` and `to` |

`check_contract` identifies a crossing either by its two ends or by one string:
`"from -http_calls-> to"`.

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

---

## Keeping it current

The server reads the database that `build` writes, and reopens it whenever its
timestamp changes. So a rebuild is picked up without restarting anything:

```sh
flowatlas build            # after pulling, or after your own change
flowatlas build --watch    # rebuild on every save, project held open
```

A rebuild of a five-repository project takes about five seconds cold and under
one when nothing moved.

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

**An answer looks cut off.** It was, and it says so. Raise `maxNodes`, or narrow
with `service` and `depth`.

---

The full command reference is [docs/CLI.md](CLI.md). The walkthrough, with a
recording of the server answering, is
[docs/getting-started.md](getting-started.md).
