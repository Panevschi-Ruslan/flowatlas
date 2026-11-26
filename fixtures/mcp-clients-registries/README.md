# mcp-clients-registries

An MCP server and a client of it in another service (P277): the client's
requests joined to the server's tools, prompts and resources, and the server's
names read as far as the source states them.

Nothing is installed, as in a fresh clone.

## assistant: what the server offers

`src/server.ts` builds a `McpServer` from `@modelcontextprotocol/server`:

| Registered | Read as |
|---|---|
| `registerTool('cancel_order', ...)` | `rpc` `tool cancel_order`, key `mcp:tool:cancel_order`, `meta.call` `tool` |
| `registerResource('catalog', 'shop://catalog', ...)` | `resource catalog`, keyed by the URI a client reads: `mcp:resource:shop://catalog` |
| `registerResource('order', new ResourceTemplate('shop://orders/{id}', ...), ...)` | `mcp:resource:shop://orders/{id}`, `keyPattern: uri-template` |
| ``registerTool(`find${collection}`, ...)`` | `mcp:tool:find{collection}`, `keyPattern: name-template`, and an info `mcp-name-dynamic` row naming the part the run decides |
| `registerTool(item.wireName, ...)` in a loop over configured items | the records `src/registry.ts` writes with `wireName` as text beside `tool`: `countOrders` and `refundOrder`, each drawn where `defineTool({...}).handler(fn)` defines it (`src/tools/*.ts`), its handler behind it, `heuristic` (the configuration decides whether it is served); an info `mcp-name-dynamic` row at the registration naming the two |
| `registerPrompt(item.wireName, ...)` | no record carries a prompt: an `mcp-name-dynamic` row, as before |

## concierge: a client in another service

`src/assistant-client.ts` makes `new Client(...)` from `@modelcontextprotocol/client`
and connects it with `assistant.connect(transport)` to
`new StreamableHTTPClientTransport(new URL(`${process.env.ASSISTANT_URL}/mcp`))`.
`ASSISTANT_URL` is the assistant's base, so every request goes there:

| Request | Joined to |
|---|---|
| `callTool({ name: 'cancel_order', arguments })` | `tool cancel_order`, `static` |
| `callTool({ name: 'countOrders' })` | `tool countOrders` in `src/tools/count-orders.ts` |
| `callTool({ name: 'findProducts' })` | `mcp:tool:find{collection}`, `heuristic` (matched by the written part) |
| `readResource({ uri: 'shop://orders/42' })` | `mcp:resource:shop://orders/{id}`, `static` |
| `getPrompt({ name: 'summarise_order' })` | nothing: a `procedure-not-found` row |
| `callTool({ name })` with `name` a parameter | nothing: a `procedure-path-dynamic` row |
