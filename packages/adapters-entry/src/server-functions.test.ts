import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { mcpServerAdapter } from './mcp-servers.js';
import { tanstackStartAdapter } from './server-functions.js';

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

/** Reads `/src/main.ts` and the rest with one adapter, nothing installed. */
const readWith = (adapter: typeof tanstackStartAdapter, main: string, files: Record<string, string> = {}): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  project.createSourceFile('/src/main.ts', main);
  const ctx: ExtractContext = {
    repo: 'app',
    repoDir: '/',
    service: { name: 'app', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'app' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return { entries: adapter.extractEntries(ctx), unresolved: ctx.builder.build().unresolved };
};

describe('TanStack Start server functions (P270)', () => {
  it('is turned on by the packages a server function is made from', () => {
    expect(tanstackStartAdapter.detect({ dependencies: { '@tanstack/react-start': '^1.0.0' } })).toBe(true);
    expect(tanstackStartAdapter.detect({ dependencies: { '@tanstack/solid-start': '^1.0.0' } })).toBe(true);
    expect(tanstackStartAdapter.detect({ dependencies: { '@tanstack/react-router': '^1.0.0' } })).toBe(false);
  });

  it('reads each chain as a way in reached by import, with its verb and what stands in front of it', () => {
    const read = readWith(
      tanstackStartAdapter,
      `
      import { createServerFn } from '@tanstack/react-start';
      import { requireSession } from './auth';
      export const listOrders = createServerFn().handler(async () => []);
      export const placeOrder = createServerFn({ method: 'post' })
        .middleware([requireSession])
        .validator((data: { sku: string }) => data)
        .handler(async ({ data }) => data);
      async function archive() { return 0; }
      const archiveOrders = createServerFn({ method: 'POST' }).handler(archive);
    `,
      { '/src/auth.ts': 'export const requireSession = {};' },
    );
    const byName = new Map(read.entries.map((entry) => [entry.meta?.['serverFunction'], entry]));
    expect([...byName.keys()].sort()).toEqual(['archiveOrders', 'listOrders', 'placeOrder']);
    expect(byName.get('listOrders')).toMatchObject({ kind: 'rpc', key: 'serverfn:src/main.ts#listOrders', meta: { method: 'GET', viaImport: true } });
    expect(byName.get('placeOrder')?.meta?.['method']).toBe('POST');
    expect(byName.get('placeOrder')?.wrapping?.map((one) => one.label)).toEqual(['requireSession']);
    expect(byName.get('archiveOrders')?.handler).toMatchObject({ functionName: 'archive' });
    expect(byName.get('archiveOrders')?.meta?.['exported']).toBe(false);
  });

  it('names a server function nothing can name, and reads no chain of a function by the same name', () => {
    const read = readWith(
      tanstackStartAdapter,
      `
      import { createServerFn } from '@tanstack/react-start';
      export const refunds = { issue: createServerFn().handler(async () => true) };
    `,
      {
        '/src/local.ts': `
          const createServerFn = () => ({ handler: (fn: () => unknown) => fn });
          export const notOne = createServerFn().handler(async () => 1);
        `,
      },
    );
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => [row.reason, row.file])).toEqual([['server-action-unread', 'src/main.ts']]);
  });
});

describe("an MCP server's tools, prompts and resources (P270)", () => {
  it('is turned on by either SDK', () => {
    expect(mcpServerAdapter.detect({ dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } })).toBe(true);
    expect(mcpServerAdapter.detect({ dependencies: { '@modelcontextprotocol/server': '^2.0.0' } })).toBe(true);
    expect(mcpServerAdapter.detect({ dependencies: { zod: '^3.0.0' } })).toBe(false);
  });

  it('reads each registration on a server the SDK makes, in both spellings', () => {
    const read = readWith(
      mcpServerAdapter,
      `
      import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
      import { lookup } from './lookup';
      const server = new McpServer({ name: 'shop', version: '1.0.0' });
      server.registerTool('find_products', { description: 'x' }, async () => ({ content: [] }));
      server.tool('stock_level', {}, lookup);
      server.registerPrompt('summarise', {}, () => ({ messages: [] }));
      server.registerResource('catalog', 'shop://catalog', {}, async () => ({ contents: [] }));
      const toolbox = { tool: (name: string, run: () => void) => run };
      toolbox.tool('hammer', () => undefined);
    `,
      { '/src/lookup.ts': 'export async function lookup() { return { content: [] }; }' },
    );
    expect(read.entries.map((entry) => entry.id).sort()).toEqual([
      'entry:app:rpc:mcp:prompt:summarise',
      'entry:app:rpc:mcp:resource:catalog',
      'entry:app:rpc:mcp:tool:find_products',
      'entry:app:rpc:mcp:tool:stock_level',
    ]);
    expect(read.entries.find((entry) => entry.key === 'mcp:tool:stock_level')?.handler).toMatchObject({ functionName: 'lookup' });
  });

  it('reads a server held as a field and one annotated with the type', () => {
    const read = readWith(
      mcpServerAdapter,
      `
      import { McpServer } from '@modelcontextprotocol/server';
      class Assistant {
        private readonly server = new McpServer({ name: 'a', version: '1' });
        start() { this.server.registerTool('ping', {}, async () => ({ content: [] })); }
      }
      export const extend = (server: McpServer) => server.registerTool('pong', {}, async () => ({ content: [] }));
    `,
    );
    expect(read.entries.map((entry) => entry.key).sort()).toEqual(['mcp:tool:ping', 'mcp:tool:pong']);
  });

  it("reads the work inside a wrapper of the repository's own as the handler", () => {
    const read = readWith(
      mcpServerAdapter,
      `
      import { McpServer } from '@modelcontextprotocol/server';
      const traced = (name: string, fn: (input: unknown) => Promise<unknown>) => async (input: unknown) => fn(input);
      const server = new McpServer({ name: 'a', version: '1' });
      server.registerTool('cancel', {}, traced('cancel', async () => ({ content: [] })));
    `,
    );
    expect(read.entries[0]?.handler).toMatchObject({ inline: true, label: 'tool cancel' });
  });

  it('names a registration whose name is decided at run time', () => {
    const read = readWith(
      mcpServerAdapter,
      `
      import { McpServer } from '@modelcontextprotocol/server';
      const server = new McpServer({ name: 'a', version: '1' });
      export const registerAll = (tools: Array<{ name: string; run: () => Promise<unknown> }>) => {
        for (const tool of tools) server.registerTool(tool.name, {}, tool.run);
      };
    `,
    );
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => row.reason)).toEqual(['mcp-name-dynamic']);
  });
});
