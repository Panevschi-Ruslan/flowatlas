import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory, with nothing installed. */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4 } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0', 'graphql-request': '^7.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

/** Each request or operation, as `<from> -> <label>`. */
const drawn = (graph: RepoGraph, type: string): string[] => {
  const ids = new Set(graph.nodes.filter((node) => node.type === type).map((node) => node.id));
  return graph.edges
    .filter((edge) => edge.type === 'calls' && ids.has(edge.to))
    .map((edge) => `${edge.from.replace(/^web#/, '')} -> ${graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to}`)
    .sort();
};

describe('a caller written in a method of a class (P293)', () => {
  it('draws a request a helper is handed its address for from the method that calls it, and follows a method handing its own parameter on', () => {
    const graph = read({
      '/src/http.ts': `export const getJson = (url: string) => fetch(url).then((res) => res.json());`,
      '/src/store.ts': [
        `import { getJson } from './http';`,
        `export class OrdersStore {`,
        `  load() { return getJson('/api/orders'); }`,
        `  item = (id: string) => getJson('/api/orders/' + id);`,
        `  byPath(path: string) { return getJson(path); }`,
        `}`,
        `export const store = new OrdersStore();`,
        `export const loadCart = () => store.byPath('/api/cart');`,
      ].join('\n'),
    });
    expect(drawn(graph, 'ui_api_call')).toEqual([
      'src/store.ts:OrdersStore.item -> GET /api/orders/:param',
      'src/store.ts:OrdersStore.load -> GET /api/orders',
      'src/store.ts:loadCart -> GET /api/cart',
    ]);
  });

  it('draws an operation a GraphQL helper is handed from the method that hands it', () => {
    const graph = read({
      '/src/gql.ts': [
        `import { request } from 'graphql-request';`,
        `export const runQuery = (document: string) => request('/graphql', document);`,
      ].join('\n'),
      '/src/store.ts': [
        `import { gql } from 'graphql-request';`,
        `import { runQuery } from './gql';`,
        `const OrdersQuery = gql\`query Orders { orders { id } }\`;`,
        `export class OrdersStore {`,
        `  load() { return runQuery(OrdersQuery); }`,
        `}`,
      ].join('\n'),
    });
    // Drawn from the method, not from the helper the client is called in.
    expect(drawn(graph, 'ui_api_call')).toEqual(['src/store.ts:OrdersStore.load -> query Orders /graphql']);
    expect(graph.nodes.find((node) => node.id === 'web#src/store.ts:OrdersStore.load')).toMatchObject({ label: 'OrdersStore.load', line: 5 });
  });
});
