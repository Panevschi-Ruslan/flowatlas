import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Item } from './registry.js';

/** Builds the server a transport is handed, with what the configuration turned on. */
export const buildServer = (items: readonly Item[], collections: readonly string[]): McpServer => {
  const server = new McpServer({ name: 'shop-assistant', version: '1.0.0' });

  // A name written as text: joined to a client's request letter for letter.
  server.registerTool('cancel_order', { description: 'Cancel one order', inputSchema: { orderId: z.string() } }, async ({ orderId }) => ({
    content: [{ type: 'text', text: `cancelled ${orderId}` }],
  }));

  // A resource is read by its URI, and a template's URI is a family of them.
  server.registerResource('catalog', 'shop://catalog', { mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, text: '[]' }],
  }));
  server.registerResource('order', new ResourceTemplate('shop://orders/{id}', { list: undefined }), {}, async (uri, { id }) => ({
    contents: [{ uri: uri.href, text: `order ${String(id)}` }],
  }));

  // A name written in part: `find` is text, the collection is the run's.
  for (const collection of collections) registerFinder(server, collection);

  // A name a record carries: read from the records the repository writes.
  for (const item of items) {
    switch (item.type) {
      case 'tool': {
        server.registerTool(item.wireName, { description: item.tool.description }, async (input: Record<string, unknown>) =>
          item.tool.handler(input),
        );
        break;
      }
      case 'prompt': {
        const prompt = item.prompt;
        server.registerPrompt(item.wireName, {}, async () => prompt.handler());
        break;
      }
    }
  }
  return server;
};

const registerFinder = (server: McpServer, collection: string): void => {
  server.registerTool(`find${collection}`, { description: `Find ${collection}` }, async () => ({
    content: [{ type: 'text', text: `${collection}: none` }],
  }));
};
