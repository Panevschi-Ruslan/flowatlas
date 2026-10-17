import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';
import type { ContractChecker } from './common.js';
import { MAX_LINES, sourceWindow } from './source.js';

/**
 * Smaller answers (P93) on a project of its own: a declaration longer than
 * one answer, a type with fields, a walk that comes back on itself, and a
 * crossing whose checker says more than the answer sends.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
const ROUTE = 'entry:orders:http:POST:/orders';
const LONG = 'orders#src/long.ts:Ledger.replay';
const LOOP_A = 'orders#src/loop.ts:Loop.a';
const LOOP_B = 'orders#src/loop.ts:Loop.b';
const REQUEST = 'http_out:orders#src/client.ts:3:1';
const TARGET = 'entry:billing:http:POST:/invoices';
const BODY_LINES = 520;

const report = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
  services: [],
  httpOut: { total: 0, linked: 0, byMarker: 0, unknownEnv: 0, noRoute: 0, ambiguous: 0, external: 0, dynamic: 0 },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
});

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [
    { name: 'orders', repo: './orders', type: 'nestjs', extractor: null },
    { name: 'billing', repo: './billing', type: 'nestjs', extractor: null },
  ],
  nodes: [
    entry(ROUTE, { label: 'POST /orders' }),
    node(LONG, { label: 'Ledger.replay', file: 'src/long.ts', line: 2 }),
    node(LOOP_A, { label: 'Loop.a' }),
    node(LOOP_B, { label: 'Loop.b' }),
    node(REQUEST, { type: 'http_out', label: 'POST /invoices' }),
    entry(TARGET, { label: 'POST /invoices', repo: 'billing' }),
  ],
  edges: [
    edge(ROUTE, LOOP_A, { type: 'handles' }),
    edge(LOOP_A, LOOP_B),
    edge(LOOP_B, LOOP_A),
    edge(LOOP_B, REQUEST, { type: 'calls' }),
    edge(REQUEST, TARGET, { type: 'http_calls', returns: 'type:billing#InvoiceDto' }),
  ],
  types: {
    'type:billing#InvoiceDto': {
      name: 'InvoiceDto',
      kind: 'object',
      declaredIn: 'billing#src/invoice.dto.ts',
      structuralHash: 'h1',
      fields: [
        { name: 'id', type: 'string', optional: false },
        { name: 'total', type: 'type:billing#Money', optional: false },
      ],
      meta: { exported: true },
    },
    'type:billing#Money': {
      name: 'Money',
      kind: 'object',
      declaredIn: 'billing#src/money.ts',
      structuralHash: 'h2',
      fields: [{ name: 'amount', type: 'number', optional: false }],
    },
  },
  unresolved: [],
};

/** What the contracts package's checker returns: far more than the answer says. */
const checker: ContractChecker = () => [
  {
    severity: 'error',
    kind: 'type-mismatch',
    direction: 'response',
    field: 'total',
    expected: 'Money',
    actual: 'number',
    message: 'total is a Money on one side and a number on the other',
    ignored: false,
    edge: { from: REQUEST, to: TARGET, type: 'http_calls' },
    edgeKey: `${REQUEST} -http_calls-> ${TARGET}`,
    sender: { service: 'orders' },
    receiver: { service: 'billing' },
    typeId: 'type:billing#InvoiceDto',
    rule: null,
    ignoredBy: null,
  } as never,
];

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'flowatlas-p93-'));
  mkdirSync(join(root, 'orders', 'src'), { recursive: true });
  mkdirSync(join(root, 'billing'), { recursive: true });
  mkdirSync(join(root, '.flowatlas'), { recursive: true });
  const body = Array.from({ length: BODY_LINES }, (_, index) => `    step(${index});`);
  writeFileSync(join(root, 'orders', 'src', 'long.ts'), ['export class Ledger {', '  replay() {', ...body, '  }', '}', ''].join('\n'));
  writeFileSync(
    join(root, 'flowatlas.config.json'),
    JSON.stringify({
      services: [
        { name: 'orders', repo: './orders', type: 'nestjs' },
        { name: 'billing', repo: './billing', type: 'nestjs' },
      ],
      output: '.flowatlas',
    }),
  );
  writeGraphDb(graph, report(), join(root, '.flowatlas', 'graph.db'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: join(root, 'flowatlas.config.json'), contractChecker: checker }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
});

describe('get_source on a declaration longer than one answer', () => {
  // The method starts on line 2 and its closing brace is on line BODY_LINES + 3.
  const end = BODY_LINES + 3;

  it('says it cut, and the line to read on from', async () => {
    const first = await call('get_source', { symbol: LONG });
    expect(first.line).toBe(2);
    expect(first.endLine).toBe(1 + MAX_LINES);
    expect(first.code.split('\n')).toHaveLength(MAX_LINES);
    expect(first.truncated).toBe(`declaration continues past line ${1 + MAX_LINES}; ask with fromLine ${2 + MAX_LINES}`);
    expect(first.next[0]).toBe(`get_source({symbol: ${JSON.stringify(LONG)}, fromLine: ${2 + MAX_LINES}})`);
  });

  it('reads on with fromLine to where the declaration ends', async () => {
    const rest = await call('get_source', { symbol: LONG, fromLine: 2 + MAX_LINES });
    expect(rest.line).toBe(2 + MAX_LINES);
    expect(rest.endLine).toBe(end);
    expect(rest.truncated).toBeUndefined();
    expect(rest.code.split('\n').at(-1)).toBe('  }');
  });

  it('takes a smaller page, and says where a page past the end would have been', async () => {
    expect(await call('get_source', { symbol: LONG, maxLines: 10 })).toMatchObject({ line: 2, endLine: 11 });
    const past = await call('get_source', { symbol: LONG, fromLine: end + 5 });
    expect(past).toMatchObject({ code: '', endLine: end, note: `the declaration ends at line ${end}` });
  });

  it('widens only the outer edges of a declaration by context', () => {
    const lines = ['a', 'f() {', '  x', '  y', '}', 'b'];
    expect(sourceWindow(lines, 1, { maxLines: 400, context: 1 })).toEqual({ from: 0, to: 5, end: 4, continues: false });
    expect(sourceWindow(lines, 1, { maxLines: 2, context: 1 })).toEqual({ from: 0, to: 2, end: 4, continues: true });
    expect(sourceWindow(lines, 1, { fromLine: 4, maxLines: 2, context: 1 })).toEqual({ from: 3, to: 5, end: 4, continues: false });
  });
});

describe('get_type at each level', () => {
  it('at 0 names the type and its fields, and nothing they are', async () => {
    const answer = await call('get_type', { type: 'type:billing#InvoiceDto', detail: 0 });
    expect(answer.type).toEqual({ id: 'type:billing#InvoiceDto', name: 'InvoiceDto', fields: ['id', 'total'] });
    expect(answer.nested).toBeUndefined();
  });

  it('at 1 says what each field is, and names what it refers to', async () => {
    const answer = await call('get_type', { type: 'type:billing#InvoiceDto' });
    expect(answer.type.fields[1]).toEqual({ name: 'total', type: 'type:billing#Money', optional: false });
    expect(answer.type.meta).toBeUndefined();
    expect(answer.nested).toEqual({ 'type:billing#Money': { name: 'Money', fields: ['amount'] } });
  });

  it('at 2 adds what the reader knows and the declarations it refers to', async () => {
    const answer = await call('get_type', { type: 'type:billing#InvoiceDto', detail: 2 });
    expect(answer.type).toMatchObject({ structuralHash: 'h1', meta: { exported: true } });
    expect(answer.nested['type:billing#Money']).toMatchObject({ kind: 'object', fields: [{ name: 'amount', type: 'number' }] });
  });
});

describe('check_contract findings', () => {
  it('say what disagrees, and leave the edge to the top of the answer', async () => {
    const answer = await call('check_contract', { from: REQUEST, to: TARGET });
    expect(answer.edge).toMatchObject({ from: REQUEST, to: TARGET, type: 'http_calls' });
    expect(answer.findings).toEqual([
      {
        severity: 'error',
        kind: 'type-mismatch',
        direction: 'response',
        field: 'total',
        expected: 'Money',
        actual: 'number',
        message: 'total is a Money on one side and a number on the other',
      },
    ]);
  });
});

describe('a walk that comes back on itself', () => {
  it('names the repeat by its id alone, and the service only where it changes', async () => {
    const flow = await call('get_flow', { entry: ROUTE });
    expect(flow.root.node.service).toBe('orders');
    const a = flow.root.children[0];
    expect(a.node).toEqual({ id: LOOP_A, type: 'method', label: 'Loop.a' });
    const b = a.children[0];
    const repeat = b.children.find((child: { node: { id: string } }) => child.node.id === LOOP_A);
    expect(repeat.node).toEqual({ id: LOOP_A, ref: true });
    const request = b.children.find((child: { node: { id: string } }) => child.node.id === REQUEST);
    expect(request.children[0].node).toMatchObject({ id: TARGET, service: 'billing' });
  });
});

describe('an answer that is an error', () => {
  it('says isError, with nothing to check against a schema', async () => {
    const reply = (await client.callTool({ name: 'what_changed', arguments: {} })) as { isError?: boolean; structuredContent?: unknown };
    expect(reply.isError).toBe(true);
    expect(reply.structuredContent).toBeUndefined();
  });
});

describe('impact with two things to say (P132)', () => {
  it('says both the walk limit and the clamp, where the clamp used to overwrite the walk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flowatlas-p132-'));
    const target = 'orders:Hub.run';
    const callers = Array.from({ length: 4100 }, (_, index) => `orders:Caller${index}.run`);
    const wide: ProjectGraph = {
      ...graph,
      services: [graph.services[0]!],
      nodes: [node(target), ...callers.map((id) => node(id))],
      edges: callers.map((id) => edge(id, target)),
      types: {},
    };
    const dbPath = join(root, 'graph.db');
    writeGraphDb(wide, report(), dbPath);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowatlasServer({ dbPath }).connect(serverSide);
    const other = new Client({ name: 'test', version: '0' });
    await other.connect(clientSide);
    try {
      const reply = (await other.callTool({ name: 'impact', arguments: { symbol: target, detail: 3 } })) as { content: Array<{ text: string }> };
      expect(JSON.parse(reply.content[0]!.text).note).toBe('reachability stopped at the walk limit; detail clamped to 2; use get_source');
    } finally {
      await other.close();
    }
  });
});
