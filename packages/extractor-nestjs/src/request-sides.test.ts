import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, RepoGraph } from '@flowatlas/core';
import { oneSidePerRequest, SAME_CALL_META } from './request-sides.js';

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

/** A repository on disk with these files, for what their names and first lines say. */
const repository = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-request-sides-')));
  temporary.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

const fn = (file: string, name: string, type = 'function'): GraphNode => ({ id: `shop#${file}:${name}`, type, label: name, repo: 'shop', file, line: 1 }) as GraphNode;

/** One call read by both halves, at a line of a file, and the function making it. */
const request = (file: string, line: number, holder: GraphNode): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const at = `shop#${file}:${line}:3`;
  const nodes = ['ui_api_call', 'http_out'].map((type) => ({ id: `${type}:${at}`, type, label: 'POST /graphql', repo: 'shop', file, line, meta: { method: 'POST' } }) as GraphNode);
  const edges = nodes.flatMap((node) => [
    { from: holder.id, to: node.id, type: 'calls', confidence: 'static' } as GraphEdge,
    { from: node.id, to: 'entry:api:http:POST:/graphql', type: node.type === 'ui_api_call' ? 'hits' : 'http_calls', confidence: 'static' } as GraphEdge,
  ]);
  return { nodes, edges };
};

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): RepoGraph => ({
  schemaVersion: 1,
  repo: 'shop',
  generatedAt: '',
  nodes,
  edges,
  types: {} as RepoGraph['types'],
  unresolved: [],
});

const calls = (from: GraphNode, to: GraphNode): GraphEdge => ({ from: from.id, to: to.id, type: 'calls', confidence: 'static' }) as GraphEdge;
const handles = (from: string, to: GraphNode): GraphEdge => ({ from, to: to.id, type: 'handles', confidence: 'static' }) as GraphEdge;
const typesAt = (graph: RepoGraph, file: string): string[] => graph.nodes.filter((node) => node.file === file && (node.type === 'ui_api_call' || node.type === 'http_out')).map((node) => node.type).sort();

describe('oneSidePerRequest', () => {
  it("draws a call a route's loader makes through a helper once, between services", () => {
    const root = repository({ 'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '2' } }) });
    const loader = fn('app/routes/orders.tsx', 'loader');
    const helper = fn('app/providers/orders.ts', 'listOrders');
    const made = request('app/providers/orders.ts', 4, helper);
    const graph = oneSidePerRequest(
      graphOf(
        [{ id: 'entry:shop:http:GET:/orders', type: 'entry', label: 'GET /orders', repo: 'shop' } as GraphNode, loader, helper, ...made.nodes],
        [handles('entry:shop:http:GET:/orders', loader), calls(loader, helper), ...made.edges],
      ),
      root,
    );
    expect(typesAt(graph, 'app/providers/orders.ts')).toEqual(['http_out']);
    expect(graph.edges.some((edge) => edge.from.startsWith('ui_api_call:') || edge.to.startsWith('ui_api_call:'))).toBe(false);
  });

  it("takes the root module's loader, which no route names, as the server's", () => {
    const root = repository({ 'package.json': JSON.stringify({ dependencies: { '@remix-run/node': '2' } }) });
    const loader = fn('app/root.tsx', 'loader');
    const made = request('app/root.tsx', 9, loader);
    expect(typesAt(oneSidePerRequest(graphOf([loader, ...made.nodes], made.edges), root), 'app/root.tsx')).toEqual(['http_out']);
  });

  it('draws a call a screen makes once, from the browser', () => {
    const root = repository({ 'package.json': '{}' });
    const screen = fn('src/Orders.tsx', 'Orders', 'ui_component');
    const made = request('src/Orders.tsx', 6, screen);
    expect(typesAt(oneSidePerRequest(graphOf([screen, ...made.nodes], made.edges), root), 'src/Orders.tsx')).toEqual(['ui_api_call']);
  });

  it('keeps both of a helper a loader and a screen both call, each naming the other', () => {
    const root = repository({ 'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '2' } }) });
    const loader = fn('app/routes/pay.tsx', 'action');
    const screen = fn('app/components/Pay.tsx', 'Pay', 'ui_component');
    const helper = fn('app/providers/pay.ts', 'pay');
    const made = request('app/providers/pay.ts', 3, helper);
    const graph = oneSidePerRequest(graphOf([loader, screen, helper, ...made.nodes], [calls(loader, helper), calls(screen, helper), ...made.edges]), root);
    const kept = graph.nodes.filter((node) => node.file === 'app/providers/pay.ts' && node.type !== 'function');
    expect(kept.map((node) => [node.type, node.meta?.[SAME_CALL_META]])).toEqual([
      ['ui_api_call', 'http_out:shop#app/providers/pay.ts:3:3'],
      ['http_out', 'ui_api_call:shop#app/providers/pay.ts:3:3'],
    ]);
  });

  it("reads a file's own side from its name and its first lines, whoever calls it", () => {
    const root = repository({
      'package.json': '{}',
      'app/session.server.ts': 'export const s = 1;\n',
      'app/widget.ts': "// a widget\n'use client';\nexport const w = 1;\n",
    });
    const screen = fn('src/Orders.tsx', 'Orders', 'ui_component');
    const server = fn('app/session.server.ts', 'load');
    const client = fn('app/widget.ts', 'load');
    const one = request('app/session.server.ts', 2, server);
    const two = request('app/widget.ts', 4, client);
    const graph = oneSidePerRequest(graphOf([screen, server, client, ...one.nodes, ...two.nodes], [calls(screen, server), ...one.edges, ...two.edges]), root);
    expect(typesAt(graph, 'app/session.server.ts')).toEqual(['http_out']);
    expect(typesAt(graph, 'app/widget.ts')).toEqual(['ui_api_call']);
  });

  it("takes a Next component under app/ as a server component unless it says 'use client'", () => {
    const root = repository({
      'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      'app/page.tsx': 'export default function Page() {}\n',
      'app/cart/page.tsx': "'use client';\nexport default function Cart() {}\n",
    });
    const page = fn('app/page.tsx', 'Page', 'ui_component');
    const cart = fn('app/cart/page.tsx', 'Cart', 'ui_component');
    const one = request('app/page.tsx', 2, page);
    const two = request('app/cart/page.tsx', 3, cart);
    const graph = oneSidePerRequest(graphOf([page, cart, ...one.nodes, ...two.nodes], [...one.edges, ...two.edges]), root);
    expect(typesAt(graph, 'app/page.tsx')).toEqual(['http_out']);
    expect(typesAt(graph, 'app/cart/page.tsx')).toEqual(['ui_api_call']);
  });

  it("keeps both of a call a SvelteKit universal load makes, which runs on either side", () => {
    const root = repository({ 'package.json': JSON.stringify({ devDependencies: { '@sveltejs/kit': '2' } }) });
    const load = fn('src/routes/orders/+page.ts', 'load');
    const helper = fn('src/lib/api.ts', 'loadOrder');
    const made = request('src/lib/api.ts', 4, helper);
    const graph = oneSidePerRequest(graphOf([load, helper, ...made.nodes], [calls(load, helper), ...made.edges]), root);
    expect(typesAt(graph, 'src/lib/api.ts')).toEqual(['http_out', 'ui_api_call']);
  });

  it('keeps both, paired, where nothing read reaches the function', () => {
    const root = repository({ 'package.json': '{}' });
    const helper = fn('lib/api.ts', 'get');
    const made = request('lib/api.ts', 2, helper);
    const graph = oneSidePerRequest(graphOf([helper, ...made.nodes], made.edges), root);
    expect(typesAt(graph, 'lib/api.ts')).toEqual(['http_out', 'ui_api_call']);
  });
});
