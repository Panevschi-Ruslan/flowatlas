# @flowatlas/mcp

The project map, offered to an agent over stdio.

This package is private: it is compiled into the `flowatlas` command, and
`flowatlas mcp` is how it is run. It is not published on its own.

Everything else builds a graph; these twenty-six tools, three prompts and three
resources are how a session sitting in one repository answers a question about
another one without opening it. A session is offered only the tools the project
can answer (`tool-needs.ts` says what each needs), and told when that changes.
[docs/mcp.md](../../docs/mcp.md) is the full reference.

## Setting it up

Build the graph once, from the directory holding `flowatlas.config.json`:

```sh
pnpm flowatlas build
```

Then add the server to the repository you work in. Put this in `.mcp.json` at
the root of that repository, with the path pointing at wherever the
configuration lives:

```json
{
  "mcpServers": {
    "flowatlas": {
      "command": "npx",
      "args": ["-y", "@flowatlas/cli", "mcp", "--config", "/absolute/path/to/flowatlas.config.json"]
    }
  }
}
```

Inside this workspace, where the package is linked rather than published:

```json
{
  "mcpServers": {
    "flowatlas": {
      "command": "node",
      "args": [
        "/absolute/path/to/flowatlas/packages/mcp/bin/flowatlas-mcp.js",
        "--config",
        "/absolute/path/to/flowatlas.config.json"
      ]
    }
  }
}
```

`--db <path>` names a database directly, and `FLOWATLAS_DB` does the same through
the environment. With neither, the server looks for a configuration from the
directory it was started in. `--all-tools` lists every tool, not only those the
project can answer.

The server answers `initialize` as `flowatlas`. Under `flowatlas mcp` its
`serverInfo.version` is the installed command's version; the workspace bin
above answers this package's own manifest version.

Confirm it is there with `claude mcp list`.

Run from this bin, the server has no contracts checker, pattern tester or
traffic checker: `check_contract` answers without field findings and
`test_pattern` says it needs the readers. `flowatlas mcp` hands it all of them.

## What it can be asked

| Tool | Answers |
|---|---|
| `start_here` | counts and gaps per service, findings, one-ended channels, the repositories probably missing, entry ids to begin from |
| `list_entries` | every way into the project, filtered by service, kind or path |
| `find_symbol` | fuzzy search, by substring or camel-case initials |
| `search` | one query over routes, channels, tables, types, gaps, failures and classes |
| `get_flow` | one entry point followed through every service it reaches, in call order |
| `who_calls` | what reaches a symbol, across repositories |
| `impact` | every entry point that can reach a symbol, and whose |
| `who_emits` / `who_consumes` | both ends of a message channel |
| `get_type` | the shape of a type, with what it refers to |
| `type_usage` | what takes or returns a type: ways in, crossings, channels, calls |
| `check_contract` | whether two services still agree about what crosses between them, and what traffic carried |
| `get_spec` | a service's routes as OpenAPI 3.1 or its channels as AsyncAPI 3.0 |
| `describe_for_prompt` | an entry, channel, symbol, gap, class, file or service as Markdown to hand on |
| `cant_follow` | why flows stop: the steps the reading could not follow, by cause and package |
| `test_pattern` | a draft extraction pattern run over code before it is suggested |
| `dead` | whether a node is dead and what could make that wrong |
| `findings` | likely N+1 loops, unguarded routes, contract breaks, one-ended channels, broken rules |
| `check_rules` | the architecture rules of the configuration and each violation |
| `what_changed` | the last `flowatlas diff` or `check`, and with `verdict` whether it is safe |
| `hot_paths` / `slow_steps` / `trace_for` | what real traffic used most, where it was slowest, and sample requests |
| `undeclared_failures` / `never_seen` | statuses traffic got that the code never declares, and what traffic never touched |
| `get_source` | the code of one symbol, and the only tool that returns code |

The prompts `before-rename`, `pr-review` and `trace-route` write out the calls a
common review takes; the resources `flowatlas://reasons`,
`flowatlas://services` and `flowatlas://services/{name}` hold the reason
catalogue, the services and one service's summary.

The tools that thin their rows take `detail` (0 identity, 1 adds location, 2
adds metadata; 3 is answered at 2 and says so) and `maxNodes` (the most rows an answer holds), which defaults
to 150 (60 for `get_flow`, which also stops at about 12,000 characters); [docs/mcp.md](../../docs/mcp.md#the-tools) lists which. Every answer is
compact JSON, in the text and as `structuredContent`, and every tool is
annotated read-only. A list that was cut says how much was left and where its
next page starts, and `next` starts with that call:

```
"total": 17, "truncated": "14 more; next page offset 3", "nextOffset": 3
```

A walk (`get_flow`, `who_calls`) does not page; it says how much it left out,
which limit did it, and the advice that helps:

```
"truncated": "12 more nodes past maxNodes 60; raise maxNodes or ask get_flow on a child id"
```

## What the answers look like

`get_flow` returns a tree in call order rather than a flat list, because the
order is half the answer. Each node carries how it was reached and how much to
trust it:

```jsonc
{
  "root": {
    "node": { "id": "entry:gateway:http:GET:/orders/:param", "type": "entry", "label": "GET /orders/:param" },
    "guards": [{ "id": "…AuthGuard", "label": "AuthGuard", "kind": "guard", "order": 0 }],
    "children": [
      {
        "node": { "id": "gateway#…:OrdersController.findOne", "type": "method" },
        "edge": { "type": "handles", "confidence": "static" },
        "children": []
      }
    ]
  },
  "unresolvedOnPath": 0
}
```

What runs before an entry is named on the entry, in the order it runs, so a 403
has an explanation. A node already on the path is shown once more as a bare
reference and not followed, so a cycle ends a branch rather than the walk.
