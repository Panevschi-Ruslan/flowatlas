import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DbHandle } from './query/db.js';
import { createFlowatlasServer, type ServerOptions } from './server.js';
import { entry, node, edge, writeTestDb } from './test-graph.js';
import { listingSettingsOf, ToolListing } from './tool-listing.js';
import { NEEDS, TOOL_NAMES, TOOL_NEEDS } from './tool-needs.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

/** The tools the multi-repo graph cannot answer: no observed file, no rules, no diff, no pattern tester. */
const UNANSWERED = ['what_changed', 'check_rules', 'test_pattern', 'hot_paths', 'slow_steps', 'trace_for', 'undeclared_failures', 'never_seen'];
const RUN_TIME = ['hot_paths', 'slow_steps', 'trace_for', 'undeclared_failures', 'never_seen'];

const dirs: string[] = [];
const clients: Client[] = [];
const tempDir = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `flowatlas-listing-${name}-`));
  dirs.push(dir);
  return dir;
};

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A connected client, counting the list-changed notifications it is sent. */
const connect = async (options: ServerOptions) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ toolsPollMs: 0, ...options }).connect(serverSide);
  const client = new Client({ name: 'listing-test', version: '0' });
  const waiting: Array<() => void> = [];
  let changes = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changes += 1;
    for (const wake of waiting.splice(0)) wake();
  });
  await client.connect(clientSide);
  clients.push(client);
  return {
    names: async (): Promise<string[]> => (await client.listTools()).tools.map((tool) => tool.name).sort(),
    call: async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; answer: any }> => {
      const response = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: response.isError === true, answer: JSON.parse(response.content[0]!.text) };
    },
    changes: (): number => changes,
    /** The next list-changed notification, or a failure after a second. */
    changed: (): Promise<void> =>
      new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('no tools/list_changed notification')), 1000);
        waiting.push(() => {
          clearTimeout(timer);
          done();
        });
      }),
  };
};

const without = (names: readonly string[]): string[] => TOOL_NAMES.filter((name) => !names.includes(name)).sort();

/** A copy of the multi-repo fixture's output, so a file can come and go beside it. */
const fixtureCopy = (name: string): string => {
  const dir = tempDir(name);
  cpSync(join(FIXTURE, '.flowatlas'), dir, { recursive: true });
  return join(dir, 'graph.db');
};

/** A configuration of one service whose `mcp` block is `mcp`, written in a directory of its own. */
const configWith = (mcp: unknown): string => {
  const dir = tempDir('config');
  mkdirSync(join(dir, 'shop'));
  const path = join(dir, 'flowatlas.config.json');
  writeFileSync(path, JSON.stringify({ services: [{ name: 'shop', repo: './shop' }], mcp }));
  return path;
};

const tester: ServerOptions['patternTester'] = async () => ({ rules: [] });

describe('the table of what each tool needs (P201)', () => {
  it('holds every tool the server registers, once, each need one the table reads', async () => {
    const all = await connect({ configPath: CONFIG, allTools: true });
    expect(await all.names()).toEqual([...TOOL_NAMES].sort());
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    for (const needs of Object.values(TOOL_NEEDS)) {
      expect(needs.length).toBeGreaterThan(0);
      for (const need of needs) expect(Object.keys(NEEDS)).toContain(need);
    }
  });

  it('refuses a tool registered without a row, and a row with no tool', () => {
    const handle = new DbHandle({ dbPath: join(tempDir('rows'), 'graph.db') });
    const settings = listingSettingsOf(undefined);
    const server = new McpServer({ name: 'test', version: '0' });
    const listing = new ToolListing(server, { handle, settings, tester: false, pollMs: 0 });
    expect(() => listing.capture(() => server.registerTool('not_a_tool', { description: 'x', inputSchema: { a: z.string() } }, () => ({ content: [] })))).toThrow(
      'tool not_a_tool has no row in TOOL_NEEDS',
    );
    const other = new McpServer({ name: 'test', version: '0' });
    expect(() => new ToolListing(other, { handle, settings, tester: false, pollMs: 0 }).capture(() => undefined)).toThrow(/rows for tools never registered: start_here, /);
  });
});

describe('the tools a project is offered (P201)', () => {
  it('are, on a graph with no observed file and no rules, those that can answer it; start_here names the rest', async () => {
    const plain = await connect({ configPath: CONFIG });
    expect(await plain.names()).toEqual(without(UNANSWERED));
    const { answer } = await plain.call('start_here');
    expect(answer.hidden).toBe(
      'what_changed: after flowatlas diff or check --env · check_rules: after rules[] in flowatlas.config.json · test_pattern: under flowatlas mcp · ' +
        'hot_paths, slow_steps, trace_for, undeclared_failures, never_seen: after flowatlas observe',
    );
    // Deciding the list told nobody: the client was listing.
    expect(plain.changes()).toBe(0);
  });

  it('answer a call of a tool not listed with what it needs, not a crash', async () => {
    const plain = await connect({ configPath: CONFIG });
    await plain.names();
    const rules = await plain.call('check_rules');
    expect(rules).toEqual({
      isError: true,
      answer: {
        error: 'check_rules is not listed for this project: no rules are configured; it appears after rules[] in flowatlas.config.json',
        needs: ['rules'],
      },
    });
    const traced = await plain.call('trace_for', { entry: 'POST /orders' });
    expect(traced.answer.error).toBe('trace_for is not listed for this project: nothing was observed beside this graph; it appears after flowatlas observe');
  });

  it('are, before any graph, those that say to build one, and test_pattern', async () => {
    const dbPath = join(tempDir('empty'), 'graph.db');
    const empty = await connect({ dbPath, patternTester: tester });
    const graphOnly = Object.entries(TOOL_NEEDS)
      .filter(([, needs]) => !needs.includes('always' as never) && !needs.includes('tester' as never))
      .map(([name]) => name);
    expect(await empty.names()).toEqual(without(graphOnly));
    expect((await empty.call('list_entries')).answer.error).toContain('run flowatlas build');
    expect((await empty.call('get_type', { type: 'OrderDto' })).answer).toEqual({
      error: `get_type is not listed until a graph is built: graph.db not found at ${dbPath}; run flowatlas build`,
      needs: ['types'],
    });

    // A first build: the graph's own tools appear, and the client is told once.
    writeTestDb(
      {
        nodes: [
          entry('entry:orders:http:POST:/orders', { label: 'POST /orders' }),
          node('orders#src/orders.service.ts:OrdersService.create'),
          node('channel:order.created', { type: 'channel', label: 'order.created', repo: '' }),
        ],
        edges: [
          edge('entry:orders:http:POST:/orders', 'orders#src/orders.service.ts:OrdersService.create', { type: 'handles' }),
          edge('orders#src/orders.service.ts:OrdersService.create', 'channel:order.created', { type: 'emits' }),
        ],
      },
      dbPath,
    );
    const told = empty.changed();
    await empty.call('start_here');
    await told;
    expect(empty.changes()).toBe(1);
    // A database with no configuration knows no repository, so get_source stays off; no type was read.
    expect(await empty.names()).toEqual(without(['get_source', 'get_type', 'type_usage', ...UNANSWERED.filter((name) => name !== 'test_pattern')]));
    expect((await empty.call('start_here')).answer.hidden).toContain('get_type, type_usage: once a build reads a type');
  });

  // POSIX only (P199): Windows refuses to replace a file the server holds open.
  it.skipIf(process.platform === 'win32')('are decided again when a build replaces the graph', async () => {
    const dbPath = join(tempDir('rebuilt'), 'graph.db');
    writeTestDb({ nodes: [entry('entry:orders:http:GET:/orders', { label: 'GET /orders' })], edges: [] }, dbPath);
    const rebuilt = await connect({ dbPath });
    expect(await rebuilt.names()).not.toContain('who_emits');
    writeTestDb(
      {
        nodes: [
          entry('entry:orders:http:GET:/orders', { label: 'GET /orders' }),
          node('channel:order.created', { type: 'channel', label: 'order.created', repo: '' }),
        ],
        edges: [],
      },
      dbPath,
    );
    // A later timestamp, whatever the clock's resolution.
    const later = new Date(Date.now() + 5000);
    utimesSync(dbPath, later, later);
    const told = rebuilt.changed();
    await rebuilt.call('list_entries');
    await told;
    expect(await rebuilt.names()).toEqual(expect.arrayContaining(['who_emits', 'who_consumes', 'get_spec']));
  });

  it('gain the run-time tools after a first observe with no call and no restart, and lose them when the file goes', async () => {
    const dbPath = fixtureCopy('observed');
    const watched = await connect({ configPath: CONFIG, dbPath, toolsPollMs: 20 });
    expect(await watched.names()).toEqual(without(UNANSWERED));

    const appeared = watched.changed();
    copyFileSync(join(FIXTURE, 'expected.cli', 'observe.json'), join(dbPath, '..', 'observed.json'));
    await appeared;
    expect(await watched.names()).toEqual(without(UNANSWERED.filter((name) => !RUN_TIME.includes(name))));
    expect((await watched.call('hot_paths')).isError).toBe(false);
    expect((await watched.call('start_here')).answer.hidden).not.toContain('flowatlas observe');

    const gone = watched.changed();
    rmSync(join(dbPath, '..', 'observed.json'));
    await gone;
    expect(await watched.names()).toEqual(without(UNANSWERED));
  });
});

describe('the mcp block of the configuration (P201)', () => {
  it('lists a tool include names whatever it needs, and never one exclude names', async () => {
    const configPath = configWith({ include: ['check_rules'], exclude: ['get_spec'] });
    const tuned = await connect({ configPath, dbPath: fixtureCopy('tuned') });
    const names = await tuned.names();
    expect(names).toContain('check_rules');
    expect(names).not.toContain('get_spec');
    // Listed, it answers for itself.
    expect((await tuned.call('check_rules')).answer.error).toBe('no rules are configured: add rules[] to flowatlas.config.json');
    expect((await tuned.call('get_spec', { service: 'orders' })).answer).toEqual({
      error: `get_spec is turned off by mcp.exclude in ${configPath}`,
      needs: ['routes', 'channels'],
    });
    expect((await tuned.call('start_here')).answer.hidden).toContain('get_spec: off in mcp.exclude');
  });

  it("lists every tool with tools: 'all' but the excluded, and every one of them with allTools (--all-tools)", async () => {
    const configPath = configWith({ tools: 'all', exclude: ['dead'] });
    const dbPath = fixtureCopy('all');
    expect(await (await connect({ configPath, dbPath })).names()).toEqual(without(['dead']));
    const every = await connect({ configPath, dbPath, allTools: true });
    expect(await every.names()).toEqual([...TOOL_NAMES].sort());
    expect((await every.call('start_here')).answer).not.toHaveProperty('hidden');
  });

  it('refuses a tool there is none of, naming it and the nearest, and a tool both listed and not', () => {
    expect(() => createFlowatlasServer({ configPath: configWith({ exclude: ['check_rule'] }) })).toThrow(
      /mcp\.exclude\.0: no tool is named "check_rule"; did you mean check_rules\?/,
    );
    expect(() => createFlowatlasServer({ configPath: configWith({ include: ['hot_paths', 'zzz'] }) })).toThrow(/mcp\.include\.1: no tool is named "zzz"$/m);
    expect(() => createFlowatlasServer({ configPath: configWith({ include: ['dead'], exclude: ['dead'] }) })).toThrow(
      '"dead" is in both mcp.include and mcp.exclude.',
    );
    expect(() => createFlowatlasServer({ configPath: configWith({ tools: 'some' }) })).toThrow(/mcp\.tools/);
  });
});
