import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lookupStock } from './stock.js';

/** What a client may ask for, by name. */
const server = new McpServer({ name: 'shop-assistant', version: '1.0.0' });

// The newer spelling: a name, a description of it, and the function that answers.
server.registerTool(
  'find_products',
  { description: 'Find products by a free-text query', inputSchema: { query: z.string() } },
  async ({ query }) => ({ content: [{ type: 'text', text: `results for ${query}` }] }),
);

// The older spelling, handed a function declared elsewhere.
server.tool('stock_level', { sku: z.string() }, lookupStock);

/** A wrapper of the repository's own around the answer: the work inside it is the handler. */
const traced =
  <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    console.time(name);
    try {
      return await fn(...args);
    } finally {
      console.timeEnd(name);
    }
  };

server.registerTool(
  'cancel_order',
  { description: 'Cancel one order', inputSchema: { orderId: z.string() } },
  traced('cancel_order', async ({ orderId }: { orderId: string }) => ({ content: [{ type: 'text' as const, text: orderId }] })),
);

server.registerPrompt(
  'summarise_order',
  { description: 'Summarise one order', argsSchema: { orderId: z.string() } },
  ({ orderId }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Summarise ${orderId}` } }] }),
);

server.registerResource('catalog', 'shop://catalog', { mimeType: 'application/json' }, async (uri) => ({
  contents: [{ uri: uri.href, text: '[]' }],
}));

interface PluginTool {
  name: string;
  config: { description: string };
  run: () => Promise<{ content: [] }>;
}

/** Tools a plugin hands in, registered under the name each carries: a row, not a way in. */
export const registerPluginTools = (tools: readonly PluginTool[]): void => {
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.run);
  }
};

/** Something else with a method called `tool`, which registers nothing. */
const toolbox = { tool: (name: string, run: () => void) => ({ name, run }) };
toolbox.tool('hammer', () => undefined);

export { server };
