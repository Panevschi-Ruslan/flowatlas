import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/**
 * A wrapper handed the verb, and a helper whose suffix defaults to nothing
 * (P91), read by the same walk the other front-end reader and the server
 * reader take.
 */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4 } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

const labels = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => node.type === 'ui_api_call')
    .map((node) => node.label)
    .sort();

describe('a verb a wrapper is handed (P91)', () => {
  it('is read at each caller its address was read at', () => {
    const graph = read({
      '/src/api.ts': `
        export const send = (method: string, path: string) => fetch(path, { method });
        export const rename = (id: string) => send('PATCH', \`/api/items/\${id}\`);
        export const remove = (id: string) => send(VERBS.remove, \`/api/items/\${id}\`);
        const VERBS = { remove: 'DELETE' } as const;
      `,
    });
    expect(labels(graph)).toEqual(['DELETE /api/items/:param', 'PATCH /api/items/:param']);
  });

  it('is read at each caller where the address is read in place', () => {
    const graph = read({
      '/src/api.ts': `
        export const sync = (method: string) => fetch('/api/sync', { method });
        export const pull = () => sync('GET');
        export const push = () => sync('POST');
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/sync', 'POST /api/sync']);
  });

  it('is unread where nobody hands one in, and not taken as the default', () => {
    const graph = read({ '/src/api.ts': `export const sync = (method: string) => fetch('/api/sync', { method });` });
    expect(labels(graph)).toEqual(['? /api/sync']);
    expect(graph.unresolved.map((row) => row.reason)).toContain('api-method-dynamic');
  });
});

describe('an argument a caller leaves out (P91)', () => {
  it('is the default the helper writes', () => {
    const graph = read({
      '/src/api.ts': `
        export const items = (suffix = '') => fetch(\`/api/items\${suffix}\`);
        export const all = () => items();
        export const one = (id: string) => items(\`/\${id}\`);
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/items', 'GET /api/items/:param']);
  });
});

describe('a verb read out of the options a wrapper is handed, or its default (R179)', () => {
  it('is the default where a caller leaves the options out, and what they write where they write one', () => {
    const graph = read({
      '/src/request.ts': `
        export const send = async (path: string, payload?: unknown, init?: RequestInit) => {
          const method = init?.method || 'POST';
          return fetch(path, { method, body: JSON.stringify(payload), ...init });
        };
      `,
      '/src/orders.ts': `
        import { send } from './request';
        const base = import.meta.env.VITE_API_URL;
        export const place = (order: unknown) => send(\`\${base}/api/orders\`, order);
        export const list = () => send(\`\${base}/api/orders\`, undefined, { method: 'GET' });
        export const archive = () => send(\`\${base}/api/orders/archive\`);
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/orders', 'POST /api/orders', 'POST /api/orders/archive']);
    expect(graph.unresolved.map((row) => row.reason)).not.toContain('api-method-dynamic');
  });

  it('is unread where a caller hands options nothing can read', () => {
    const graph = read({
      '/src/api.ts': `
        const send = (url: string, options?: RequestInit) => fetch(url, { method: options?.method ?? 'POST' });
        declare const init: RequestInit;
        export const save = () => send('/api/orders', init);
      `,
    });
    expect(labels(graph)).toEqual(['? /api/orders']);
    expect(graph.unresolved.map((row) => row.reason)).toContain('api-method-dynamic');
  });
});

describe('a request handed in as one object whose members the wrapper takes out where its parameter is written (P269)', () => {
  const REQUEST = `
    interface Options { url: string; method?: 'GET' | 'POST' | 'DELETE'; body?: object; queryParams?: Record<string, string> }
    const request = async <T>({ url = '', method = 'GET', body, queryParams = {} }: Options): Promise<T> => {
      const response = await fetch(\`\${url}?\${new URLSearchParams(queryParams).toString()}\`, { method, body: JSON.stringify(body) });
      return (await response.json()) as T;
    };
    export default request;
  `;

  it('reads the address and the verb at each caller, the verb defaulting to what the pattern writes', () => {
    const graph = read({
      '/src/request.ts': REQUEST,
      '/src/api.ts': `
        import request from './request';
        const basePath = '/api';
        const Api = () => ({
          basket() { return request({ url: \`\${basePath}/basket\`, queryParams: { sessionId: 's' } }); },
          add() { return request({ url: \`\${basePath}/basket\`, method: 'POST', body: {} }); },
          empty() { return request({ url: \`\${basePath}/basket\`, method: 'DELETE' }); },
        });
        export default Api();
      `,
    });
    expect(labels(graph)).toEqual(['DELETE /api/basket', 'GET /api/basket', 'POST /api/basket']);
  });

  it('leaves the request at the wrapper where a caller hands an object nothing here wrote', () => {
    const graph = read({
      '/src/request.ts': REQUEST,
      '/src/api.ts': `
        import request from './request';
        declare const options: { url: string };
        export const fetchIt = () => request(options);
      `,
    });
    expect(labels(graph).every((label) => !label.includes('/api'))).toBe(true);
    expect(labels(graph)).toHaveLength(1);
  });
});
