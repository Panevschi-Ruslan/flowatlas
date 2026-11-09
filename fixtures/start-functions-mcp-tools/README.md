# start-functions-mcp-tools

Two kinds of way in a caller reaches by a name rather than an address (P270):
the server functions of a TanStack Start application, which its browser code
imports and calls, and the tools, prompts and resources of an MCP server,
which a client asks for by the name each was registered under.

Nothing is installed, as in a fresh clone.

## storefront: server functions

`app/server/orders.functions.ts` makes four with `createServerFn` from
`@tanstack/react-start`:

| Declared | Read as |
|---|---|
| `export const listOrders = createServerFn().handler(async () => ...)` | `rpc` `server function listOrders`, `GET` (the library's default), handled by the function written there |
| `export const placeOrder = createServerFn({ method: 'POST' }).middleware([requireSession]).validator(...).handler(...)` | `POST`, with `requireSession` in front of it |
| `const archiveOrders = createServerFn({ method: 'POST' }).handler(archiveOldOrders)` | kept to its module, handled by `archiveOldOrders` |
| `refunds = { issue: createServerFn(...).handler(...) }` | nothing names what the browser imports: a `server-action-unread` row |

Each is keyed `serverfn:<file>#<name>` and reached by import, as a Next server
action is: `app/routes/orders.tsx` imports `listOrders` and `placeOrder` and
calls them, and each call is a `calls` edge from `OrdersPage` to the way in.
Before P270 none of these was read, and the file, which the counting rule
sees as `.handler(fn)` chains, was silent.

## assistant: an MCP server

`src/server.ts` makes `new McpServer(...)` from the SDK and registers:

| Registered | Read as |
|---|---|
| `server.registerTool('find_products', config, async (...) => ...)` | `rpc` `tool find_products`, key `mcp:tool:find_products` |
| `server.tool('stock_level', schema, lookupStock)` | `tool stock_level`, handled by `lookupStock` in `src/stock.ts` |
| `server.registerTool('cancel_order', config, traced('cancel_order', async (...) => ...))` | `tool cancel_order`, handled by the function inside the repository's own wrapper |
| `server.registerPrompt('summarise_order', ...)` | `prompt summarise_order` |
| `server.registerResource('catalog', 'shop://catalog', ...)` | `resource catalog` |
| `server.registerTool(tool.name, ...)` in a loop over tools a plugin hands in | a name decided at run time: an `mcp-name-dynamic` row |
| `toolbox.tool('hammer', ...)` on a plain object | nothing: not a server |

The receiver is an MCP server by its type where the SDK is installed, and
otherwise by the source: a value made with `new McpServer(...)`, or annotated
with the type, imported from `@modelcontextprotocol/sdk` or
`@modelcontextprotocol/server`.
