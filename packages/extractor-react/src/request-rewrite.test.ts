import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory, with nothing installed (P244, as P239). */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, jsx: 4 },
  });
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

const requests = (graph: RepoGraph): GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'ui_api_call').sort((a, b) => a.id.localeCompare(b.id));

/** Each request as `METHOD url`, the address as the graph records it. */
const addresses = (graph: RepoGraph): string[] =>
  requests(graph)
    .map((node) => `${String(node.meta?.['method'])} ${String(node.meta?.['url'])}`)
    .sort();

const rows = (graph: RepoGraph) => graph.unresolved.filter((row) => row.reason === 'api-client-base-unread');

/** A screen calling whatever `./api` exports, so a request has somewhere to be written. */
const PANEL = (calls: string): string => `
  import { api } from './api';
  export const Panel = () => {
    const load = () => { ${calls} };
    return <button onClick={load} />;
  };
`;

/** An axios instance made with no base, and an interceptor registered on it. */
const AXIOS_WITH = (interceptor: string, made = 'axios.create()'): string =>
  [`import axios from 'axios';`, `export const api = ${made};`, `api.interceptors.request.use(${interceptor});`, ''].join('\n');

describe('an axios request interceptor that sets the base (P244)', () => {
  it('reads `config.baseURL = X; return config` into every request through the instance', () => {
    const graph = read({
      '/src/api.ts': AXIOS_WITH('(config) => { config.baseURL = import.meta.env.VITE_ORDERS_URL; return config; }'),
      '/src/Panel.tsx': PANEL(`api.get('/orders'); api.post('/orders', { name: 'a' });`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_ORDERS_URL}/orders', 'POST ${VITE_ORDERS_URL}/orders']);
    expect(requests(graph)[0]?.meta).toMatchObject({ baseUrlEnv: 'VITE_ORDERS_URL', baseFrom: 'interceptor', client: 'axios' });
    expect(rows(graph)).toEqual([]);
  });

  it('reads the spread, Object.assign and an arrow answering the options in place', () => {
    for (const interceptor of [
      '(config) => ({ ...config, baseURL: "/v2" })',
      '(config) => { return { ...config, baseURL: "/v2" }; }',
      '(config) => Object.assign(config, { baseURL: "/v2" })',
      'function (config) { Object.assign(config, { baseURL: "/v2" }); return config; }',
    ]) {
      const graph = read({ '/src/api.ts': AXIOS_WITH(interceptor), '/src/Panel.tsx': PANEL(`api.get('/orders');`) });
      expect(addresses(graph), interceptor).toEqual(['GET /v2/orders']);
    }
  });

  it('reads `config.url = X + config.url` and the template spelling, under the instance base', () => {
    const plus = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { config.url = '/v1' + config.url; return config; }`, `axios.create({ baseURL: '/api' })`),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(plus)).toEqual(['GET /api/v1/orders']);
    const template = read({
      '/src/api.ts': AXIOS_WITH('(config) => { config.url = `${import.meta.env.VITE_ORDERS_URL}${config.url}`; return config; }'),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(template)).toEqual(['GET ${VITE_ORDERS_URL}/orders']);
  });

  it('sets the base over the call option, and only where none is set when it says so', () => {
    const over = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { config.baseURL = '/forced'; return config; }`),
      '/src/Panel.tsx': PANEL(`api.get('/orders', { baseURL: '/own' });`),
    });
    expect(addresses(over)).toEqual(['GET /forced/orders']);
    for (const interceptor of [
      `(config) => { config.baseURL ??= '/fallback'; return config; }`,
      `(config) => { if (!config.baseURL) config.baseURL = '/fallback'; return config; }`,
      `(config) => ({ ...config, baseURL: config.baseURL ?? '/fallback' })`,
    ]) {
      const graph = read({
        '/src/api.ts': AXIOS_WITH(interceptor),
        '/src/Panel.tsx': PANEL(`api.get('/orders', { baseURL: '/own' }); api.get('/items');`),
      });
      expect(addresses(graph), interceptor).toEqual(['GET /fallback/items', 'GET /own/orders']);
    }
    const kept = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { config.baseURL ??= '/fallback'; return config; }`, `axios.create({ baseURL: '/made' })`),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(kept)).toEqual(['GET /made/orders']);
    expect(requests(kept)[0]?.meta?.['baseFrom']).toBeUndefined();
  });

  it('follows a named interceptor, one registered on `axios` itself, and one in a class constructor', () => {
    const named = read({
      '/src/base.ts': `export const withBase = (config) => { config.baseURL = '/named'; return config; };\n`,
      '/src/api.ts': `import axios from 'axios';\nimport { withBase } from './base';\nexport const api = axios.create();\napi.interceptors.request.use(withBase, (error) => Promise.reject(error));\n`,
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(named)).toEqual(['GET /named/orders']);

    const global = read({
      '/src/setup.ts': `import axios from 'axios';\naxios.interceptors.request.use((config) => { config.baseURL = '/global'; return config; });\n`,
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: '/own' });\n`,
      '/src/Panel.tsx': `
        import axios from 'axios';
        import { api } from './api';
        export const Panel = () => {
          const load = () => { axios.get('/orders'); api.get('/items'); };
          return <button onClick={load} />;
        };
      `,
    });
    // An instance has interceptors of its own: the module's are not its.
    expect(addresses(global)).toEqual(['GET /global/orders', 'GET /own/items']);

    const field = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `class ApiService {`,
        `  private http = axios.create();`,
        `  constructor() { this.http.interceptors.request.use((config) => { config.baseURL = '/field'; return config; }); }`,
        `  get(path: string) { return this.http.get(path); }`,
        `}`,
        `export const api = new ApiService();`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(field)).toEqual(['GET /field/orders']);
  });

  it('changes nothing for an interceptor that only sets headers, or that guards on an absolute address', () => {
    const headers = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { config.headers.Authorization = 'Bearer x'; return config; }`, `axios.create({ baseURL: '/api' })`),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(headers)).toEqual(['GET /api/orders']);
    expect(rows(headers)).toEqual([]);
    const guarded = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { if (!config.url.startsWith('http')) config.url = '/v1' + config.url; return config; }`),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(guarded)).toEqual(['GET /v1/orders']);
    expect(rows(guarded)).toEqual([]);
  });

  it('is a row, not a pick, where the base is chosen by a branch, behind a condition, or unread', () => {
    const cases = [
      [`(config) => { config.baseURL = config.url.includes('admin') ? '/admin' : '/shop'; return config; }`, 'one of two bases by a branch'],
      [`(config) => { if (config.method === 'post') config.baseURL = '/writes'; return config; }`, 'only when config.method'],
      [`(config) => { config.baseURL = localStorage.getItem('base'); return config; }`, 'could not be read'],
      [`(config) => { config.url = config.url.replace('/v1', '/v2'); return config; }`, 'the base it puts in front could not be read'],
    ] as const;
    for (const [interceptor, why] of cases) {
      const graph = read({
        '/src/api.ts': AXIOS_WITH(interceptor, `axios.create({ baseURL: '/made' })`),
        '/src/Panel.tsx': PANEL(`api.get('/orders'); api.post('/orders', {});`),
      });
      // The instance keeps the base it was made with, and one row names the line.
      expect(addresses(graph), interceptor).toEqual(['GET /made/orders', 'POST /made/orders']);
      expect(rows(graph), interceptor).toHaveLength(1);
      expect(rows(graph)[0]?.hint, interceptor).toContain(why);
      expect(rows(graph)[0]).toMatchObject({ file: 'src/api.ts', line: 3 });
    }
  });

  it('is a row where two interceptors set different bases', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `export const api = axios.create();`,
        `api.interceptors.request.use((config) => { config.baseURL = '/one'; return config; });`,
        `api.interceptors.request.use((config) => { config.baseURL = '/two'; return config; });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(graph)).toEqual(['GET /orders']);
    expect(rows(graph)).toHaveLength(1);
    expect(rows(graph)[0]?.hint).toContain('rewrite the address differently');
  });
});

describe('axios called with one config object (P244)', () => {
  it('reads the url, method and data of `api({ ... })`, `axios({ ... })` and `request({ ... })`', () => {
    const graph = read({
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: import.meta.env.VITE_ORDERS_URL });\n`,
      '/src/Panel.tsx': `
        import axios from 'axios';
        import { api } from './api';
        export const Panel = () => {
          const load = () => {
            api({ url: '/orders', method: 'post', data: { name: 'a' } });
            api.request({ url: '/orders/1', method: 'DELETE' });
            axios({ url: '/health' });
            axios.request({ url: '/items', method: 'put', baseURL: '/own' });
          };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual([
      'DELETE ${VITE_ORDERS_URL}/orders/1',
      'GET /health',
      'POST ${VITE_ORDERS_URL}/orders',
      'PUT /own/items',
    ]);
    const post = requests(graph).find((node) => node.meta?.['method'] === 'POST');
    expect(post?.meta).toMatchObject({ bodyFrom: 'literal', bodyKeys: ['name'] });
    const put = requests(graph).find((node) => node.meta?.['method'] === 'PUT');
    expect(put?.meta?.['baseFrom']).toBe('call');
  });

  it('carries an interceptor base into a config call too', () => {
    const graph = read({
      '/src/api.ts': AXIOS_WITH(`(config) => { config.baseURL = '/v3'; return config; }`),
      '/src/Panel.tsx': PANEL(`api({ url: '/orders', method: 'patch' });`),
    });
    expect(addresses(graph)).toEqual(['PATCH /v3/orders']);
  });
});

describe('ofetch and $fetch hooks that rewrite the address (P244)', () => {
  it('reads `onRequest({ options }) { options.baseURL = X }` written as a method, a property and a list', () => {
    for (const hook of [
      `onRequest({ options }) { options.baseURL = import.meta.env.VITE_BILLING_URL; }`,
      `onRequest: (ctx) => { ctx.options.baseURL = import.meta.env.VITE_BILLING_URL; }`,
      `onRequest: [({ options }) => { options.baseURL = import.meta.env.VITE_BILLING_URL; }]`,
    ]) {
      const graph = read({
        '/src/api.ts': `import { ofetch } from 'ofetch';\nexport const api = ofetch.create({ ${hook} });\n`,
        '/src/Panel.tsx': PANEL(`api('/items', { method: 'POST', body: { a: 1 } });`),
      });
      expect(addresses(graph), hook).toEqual(['POST ${VITE_BILLING_URL}/items']);
      expect(requests(graph)[0]?.meta?.['baseFrom'], hook).toBe('interceptor');
    }
  });

  it('reads `ctx.request = X + ctx.request`, and keeps a parent hook an instance of it does not replace', () => {
    const graph = read({
      '/src/api.ts': [
        `export const api = $fetch.create({ onRequest(ctx) { ctx.request = '/v1' + ctx.request; } });`,
        `export const child = api.create({ baseURL: '/api' });`,
        `export const own = api.create({ onRequest({ options }) { options.baseURL = '/own'; } });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { api, child, own } from './api';
        export const Panel = () => {
          const load = () => { api('/a'); child('/b'); own('/c'); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET /api/v1/b', 'GET /own/c', 'GET /v1/a']);
  });

  it('reads a hook in a factory of the repository with its base handed in', () => {
    const graph = read({
      '/src/api.ts': [
        `import { ofetch } from 'ofetch';`,
        `const make = (base: string) => ofetch.create({ onRequest({ options }) { options.baseURL = base; } });`,
        `export const api = make(import.meta.env.VITE_ORDERS_URL);`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api('/orders');`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_ORDERS_URL}/orders']);
  });
});

describe('ky beforeRequest hooks that replace the request (P244)', () => {
  it('reads a new Request at a prefixed address built from the old one', () => {
    const graph = read({
      '/src/api.ts': [
        `import ky from 'ky';`,
        `export const api = ky.create({ prefixUrl: '/api', hooks: { beforeRequest: [`,
        '  (request) => new Request(`${import.meta.env.VITE_BILLING_URL}${new URL(request.url).pathname}`, request),',
        `] } });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('items');`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_BILLING_URL}/api/items']);
  });

  it('is a row where the new address cannot be read, and changes nothing for a hook that sets a header', () => {
    const unread = read({
      '/src/api.ts': `import ky from 'ky';\nexport const api = ky.create({ prefixUrl: '/api', hooks: { beforeRequest: [(request) => { return new Request(pick(request), request); }] } });\n`,
      '/src/Panel.tsx': PANEL(`api.get('items');`),
    });
    expect(addresses(unread)).toEqual(['GET /api/items']);
    expect(rows(unread)).toHaveLength(1);
    const headers = read({
      '/src/api.ts': `import ky from 'ky';\nexport const api = ky.create({ prefixUrl: '/api', hooks: { beforeRequest: [(request) => { request.headers.set('x', '1'); }] } });\n`,
      '/src/Panel.tsx': PANEL(`api.get('items');`),
    });
    expect(addresses(headers)).toEqual(['GET /api/items']);
    expect(rows(headers)).toEqual([]);
  });
});
