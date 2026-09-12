# @flowatlas/mcp

The project map, offered to an agent over stdio.

Everything before this built a graph nobody read. These ten tools are how a
session sitting in one repository answers a question about another one without
opening it.

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
directory it was started in.

Confirm it is there with `claude mcp list`.

## What it can be asked

| Tool | Answers |
|---|---|
| `list_entries` | every way into the project, filtered by service, kind or path |
| `get_flow` | one entry point followed through every service it reaches |
| `who_calls` | what reaches a symbol, across repositories |
| `impact` | every entry point that can reach a symbol, and whose |
| `who_emits` / `who_consumes` | both ends of a message channel |
| `get_type` | the shape of a type, with what it refers to |
| `check_contract` | whether two services still agree about what crosses between them |
| `find_symbol` | fuzzy search, by substring or camel-case initials |
| `get_source` | the code of one symbol, and the only tool that returns code |

Every tool takes `detail` (0 identity, 1 adds location, 2 adds metadata; 3 is
answered at 2 and says so) and `maxNodes`, which defaults to 150. An answer that
was cut always says how much was left:

```
"truncated": "12 more nodes, increase depth or narrow scope"
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
