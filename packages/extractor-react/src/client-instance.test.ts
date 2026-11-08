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

/**
 * Reads a repository written in memory, with nothing installed.
 *
 * Nothing installed is the point: the instance is told apart by the import its
 * factory is called on, so a clone whose `axios` the checker cannot open is read
 * the same as a built one (P239).
 */
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

const rows = (graph: RepoGraph, reason: string) => graph.unresolved.filter((row) => row.reason === reason);

/** A screen calling whatever `./api` exports, so a request has somewhere to be written. */
const PANEL = (calls: string): string => `
  import { api } from './api';
  export const Panel = () => {
    const load = () => { ${calls} };
    return <button onClick={load} />;
  };
`;

describe('an axios instance carries the base it was made with (P239)', () => {
  it('reads a base rooted at a settings key, and the address is the two together', () => {
    const graph = read({
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: import.meta.env.VITE_ORDERS_URL });\n`,
      '/src/Panel.tsx': PANEL(`api.get('/orders'); api.post('/orders', { name: 'a' });`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_ORDERS_URL}/orders', 'POST ${VITE_ORDERS_URL}/orders']);
    expect(requests(graph)[0]?.meta).toMatchObject({ baseUrlEnv: 'VITE_ORDERS_URL', path: '/orders', client: 'axios', via: 'template-env' });
    expect(rows(graph, 'api-client-base-unread')).toEqual([]);
  });

  it('reads a literal, a template, a constant from another module and a host', () => {
    const graph = read({
      '/src/config.ts': `export const API_ROOT = '/api';\n`,
      '/src/api.ts': [
        `import axios from 'axios';`,
        `import { API_ROOT } from './config';`,
        `export const literal = axios.create({ baseURL: '/v1' });`,
        'export const template = axios.create({ baseURL: `${API_ROOT}/v2` });',
        `export const constant = axios.create({ baseURL: API_ROOT });`,
        `export const host = axios.create({ baseURL: 'https://billing.example.test/api' });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { literal, template, constant, host } from './api';
        export const Panel = () => {
          const load = () => { literal.get('/a'); template.get('/b'); constant.get('/c'); host.get('/d'); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET /api/c', 'GET /api/v2/b', 'GET /v1/a', 'GET https://billing.example.test/api/d']);
    const host = requests(graph).find((node) => node.meta?.['url'] === 'https://billing.example.test/api/d');
    expect(host?.meta).toMatchObject({ host: 'billing.example.test', path: '/api/d' });
  });

  it('reads Next.js public settings through process.env', () => {
    const graph = read({
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL });\n`,
      '/src/Panel.tsx': PANEL(`api.delete('/orders/1');`),
    });
    expect(requests(graph)[0]?.meta).toMatchObject({ method: 'DELETE', baseUrlEnv: 'NEXT_PUBLIC_API_URL', path: '/orders/1' });
  });

  it('follows a default export, a re-export, a class field and a factory of the repository', () => {
    const graph = read({
      '/src/http.ts': `import axios from 'axios';\nexport default axios.create({ baseURL: '/one' });\n`,
      '/src/index.ts': `export { default as http } from './http';\n`,
      '/src/make.ts': [
        `import axios from 'axios';`,
        `export const createApi = (baseURL: string) => axios.create({ baseURL, timeout: 5000 });`,
        `export const made = createApi(import.meta.env.VITE_MADE_URL);`,
        '',
      ].join('\n'),
      '/src/service.ts': [
        `import axios from 'axios';`,
        `export const clients = { orders: axios.create({ baseURL: '/three' }) };`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { http } from './index';
        import { made } from './make';
        import { clients } from './service';
        export const Panel = () => {
          const load = () => { http.get('/a'); made.get('/b'); clients.orders.get('/orders'); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_MADE_URL}/b', 'GET /one/a', 'GET /three/orders']);
  });

  it('keeps the base of the instance an instance is made from, unless it writes its own', () => {
    const graph = read({
      '/src/api.ts': [
        `import ky from 'ky';`,
        `const root = ky.create({ prefixUrl: '/api' });`,
        `export const api = root.extend({ timeout: 1000 });`,
        `export const admin = root.extend({ prefixUrl: '/admin' });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { api, admin } from './api';
        export const Panel = () => {
          const load = () => { api.get('orders'); admin.post('users', { json: { name: 'a' } }); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET /api/orders', 'POST /admin/users']);
    const posted = requests(graph).find((node) => node.meta?.['method'] === 'POST');
    expect(posted?.meta).toMatchObject({ client: 'ky', package: 'ky', bodyKeys: ['name'] });
  });

  it('lets a base assigned to the defaults afterwards win, and says when two assignments disagree', () => {
    const graph = read({
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: '/old' });\nexport const other = axios.create();\n`,
      '/src/main.ts': [
        `import { api, other } from './api';`,
        `api.defaults.baseURL = import.meta.env.VITE_API_URL;`,
        `other.defaults.baseURL = '/a';`,
        `export const setup = () => { other.defaults.baseURL = '/b'; };`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { api, other } from './api';
        export const Panel = () => {
          const load = () => { api.get('/orders'); other.get('/users'); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_API_URL}/orders', 'GET /users']);
    expect(rows(graph, 'api-client-base-unread')).toMatchObject([{ file: 'src/main.ts', line: 4 }]);
    expect(rows(graph, 'api-client-base-unread')[0]?.hint).toContain('2 different values');
  });

  it("records the query a call writes under its client's query option, its keys where written in place (P256)", () => {
    const graph = read({
      '/src/Panel.tsx': `
        import axios from 'axios';
        import ky from 'ky';
        import { ofetch } from 'ofetch';
        declare const config: { params: { page: number } };
        export const Panel = () => {
          const load = () => {
            axios.get('/a', { params: { category: 'tea', limit: 10 } });
            ky.get('b', { searchParams: { page: 2 } });
            ofetch('/c', { query: { q: 'x' } });
            axios.get('/d', config);
            axios.get('/e');
          };
          return <button onClick={load} />;
        };
      `,
    });
    const at = (path: string) => requests(graph).find((node) => String(node.meta?.['path']).endsWith(path))?.meta ?? {};
    expect(at('/a')).toMatchObject({ queryKeys: ['category', 'limit'] });
    expect(at('/b')).toMatchObject({ queryKeys: ['page'] });
    expect(at('/c')).toMatchObject({ queryKeys: ['q'] });
    expect(at('/d')).toMatchObject({ queryUnread: true });
    expect(at('/e')['queryKeys']).toBeUndefined();
    expect(at('/e')['queryUnread']).toBeUndefined();
  });

  it('records a query built in code, under the option or written into the address, and the names of the headers a call writes (P258)', () => {
    const graph = read({
      '/src/Panel.tsx': `
        import axios from 'axios';
        export const Panel = () => {
          const load = (key: string) => {
            const query = new URLSearchParams({ q: 'tea' });
            query.set('limit', '10');
            fetch(\`/a?\${query}\`, { headers: { 'X-Tenant': 'north' } });
            axios.get('/b', { params: new URLSearchParams([['page', '2']]), headers: new Headers({ Accept: 'json' }) });
            const loose = new URLSearchParams();
            loose.append(key, 'x');
            fetch(\`/c?\${loose.toString()}\`);
          };
          return <button onClick={load} />;
        };
      `,
    });
    const at = (path: string) => requests(graph).find((node) => String(node.meta?.['path']).endsWith(path))?.meta ?? {};
    expect(at('/a')).toMatchObject({ queryKeys: ['limit', 'q'], headerKeys: ['x-tenant'] });
    expect(at('/b')).toMatchObject({ queryKeys: ['page'], headerKeys: ['accept'] });
    expect(at('/c')).toMatchObject({ queryUnread: true });
  });

  it('applies the module defaults to calls on the module itself', () => {
    const graph = read({
      '/src/main.ts': `import axios from 'axios';\naxios.defaults.baseURL = '/api';\n`,
      '/src/Panel.tsx': `
        import axios from 'axios';
        export const Panel = () => {
          const load = () => { axios.get('/orders'); axios('/users', { method: 'post', data: { name: 'a' } }); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET /api/orders', 'POST /api/users']);
    expect(requests(graph).find((node) => node.meta?.['method'] === 'POST')?.meta).toMatchObject({ bodyKeys: ['name'] });
  });

  it('lets the call write its own base, and an absolute address win over the base', () => {
    const graph = read({
      '/src/api.ts': `import axios from 'axios';\nexport const api = axios.create({ baseURL: '/api' });\n`,
      '/src/Panel.tsx': PANEL(`api.get('/orders', { baseURL: '/auth' }); api.get('https://status.example.test/health'); api.get(\`\${import.meta.env.VITE_OTHER}/x\`);`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_OTHER}/x', 'GET /auth/orders', 'GET https://status.example.test/health']);
  });

  it('says once, where the instance is made, when its base cannot be read, and keeps the path', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `const pick = () => (Math.random() > 0.5 ? '/a' : '/b');`,
        `export const api = axios.create({ baseURL: pick(), timeout: 1 });`,
        `export const plain = axios.create({ timeout: 1 });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders'); api.get('/users');`).replace(`import { api } from './api';`, `import { api, plain } from './api';`).replace(`api.get('/users');`, `api.get('/users'); plain.get('/plain');`),
    });
    expect(addresses(graph)).toEqual(['GET /orders', 'GET /plain', 'GET /users']);
    expect(rows(graph, 'api-client-base-unread')).toMatchObject([{ file: 'src/api.ts', line: 3, symbol: 'pick()' }]);
  });

  it('says so when the options are handed in from somewhere it cannot read', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `declare const options: any;`,
        `export const api = axios.create({ ...options.http });`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(graph)).toEqual(['GET /orders']);
    expect(rows(graph, 'api-client-base-unread')).toMatchObject([{ file: 'src/api.ts', line: 3 }]);
  });

  it('reads an instance handed in from outside as the client, with no base and nothing said', () => {
    const graph = read({
      '/src/use.ts': `import type { AxiosInstance } from 'axios';\nexport const load = (api: AxiosInstance) => api.get('/orders');\n`,
    });
    expect(rows(graph, 'api-client-base-unread')).toEqual([]);
  });
});

describe('a client class of the repository holding an instance (P239)', () => {
  it('takes the base of the instance its verbs reach, where the class keeps none of its own', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `class ApiService {`,
        `  private http = axios.create({ baseURL: import.meta.env.VITE_API_URL });`,
        `  get(path: string) { return this.http.get(path); }`,
        `  post(path: string, body: unknown) { return this.http.post(path, body); }`,
        `}`,
        `export const api = new ApiService();`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders'); api.post('/orders', { name: 'a' });`),
    });
    expect(addresses(graph)).toEqual(['GET ${VITE_API_URL}/orders', 'POST ${VITE_API_URL}/orders']);
    expect(requests(graph)[0]?.meta).toMatchObject({ client: 'ApiService', localClient: 'recognised' });
  });

  it('finds a defaults assignment to the field, and to an instance written with a cast', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios, { type AxiosInstance } from 'axios';`,
        `class ApiService {`,
        `  private http = axios.create();`,
        `  constructor() { this.http.defaults.baseURL = '/inner'; }`,
        `  get(path: string) { return this.http.get(path); }`,
        `}`,
        `export const api = new ApiService();`,
        `export const cast = axios.create() as AxiosInstance;`,
        `cast.defaults.baseURL = '/cast';`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders'); cast.get('/users');`).replace(`import { api } from './api';`, `import { api, cast } from './api';`),
    });
    expect(addresses(graph)).toEqual(['GET /cast/users', 'GET /inner/orders']);
  });

  it('says where the instance is made when its base cannot be read, and takes no base', () => {
    const graph = read({
      '/src/api.ts': [
        `import axios from 'axios';`,
        `declare const pick: () => string;`,
        `class ApiService {`,
        `  private http = axios.create({ baseURL: pick() });`,
        `  get(path: string) { return this.http.get(path); }`,
        `}`,
        `export const api = new ApiService();`,
        '',
      ].join('\n'),
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(addresses(graph)).toEqual(['GET /orders']);
    expect(rows(graph, 'api-client-base-unread')).toMatchObject([{ file: 'src/api.ts', line: 4 }]);
  });
});

describe('ofetch, $fetch and ky instances (P239)', () => {
  it('reads an ofetch instance called as a function, and its raw call', () => {
    const graph = read({
      '/src/api.ts': `import { ofetch } from 'ofetch';\nexport const api = ofetch.create({ baseURL: '/api' });\n`,
      '/src/Panel.tsx': PANEL(`api('/orders', { method: 'POST', body: { name: 'a' } }); api.raw('/orders/1');`),
    });
    expect(addresses(graph)).toEqual(['GET /api/orders/1', 'POST /api/orders']);
    expect(requests(graph)[0]?.meta).toMatchObject({ client: 'ofetch' });
  });

  it("reads Nuxt's global $fetch.create with a runtime setting", () => {
    const graph = read({
      '/src/api.ts': `export const api = $fetch.create({ baseURL: useRuntimeConfig().public.apiBase });\n`,
      '/src/Panel.tsx': PANEL(`api('/orders');`),
    });
    expect(requests(graph)[0]?.meta).toMatchObject({ method: 'GET', baseUrlEnv: 'apiBase', path: '/orders' });
  });

  it('reads ky on the module and through an instance, its body under json', () => {
    const graph = read({
      '/src/api.ts': `import ky from 'ky';\nexport const api = ky.create({ prefixUrl: import.meta.env.VITE_API_URL });\n`,
      '/src/Panel.tsx': `
        import ky from 'ky';
        import { api } from './api';
        export const Panel = () => {
          const load = () => { ky.get('/health'); api('orders', { method: 'put', json: { name: 'a' } }); api.patch('orders/1', { json: { name: 'b' } }); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET /health', 'PATCH ${VITE_API_URL}/orders/1', 'PUT ${VITE_API_URL}/orders']);
  });

  it('does not read a function of the repository named like an instance as one', () => {
    const graph = read({
      '/src/api.ts': `export const api = { get: (key: string) => localStorage.getItem(key) };\nexport const create = () => api;\n`,
      '/src/Panel.tsx': PANEL(`api.get('/orders');`),
    });
    expect(requests(graph)).toEqual([]);
  });
});

describe('a fetch wrapper that puts a constant in front (P239)', () => {
  it('reads the constant from another module, and a public setting', () => {
    const graph = read({
      '/src/config.ts': `export const API_BASE = '/api';\n`,
      '/src/request.ts': [
        `import { API_BASE } from './config';`,
        'export const request = (path: string, method: string) => fetch(`${API_BASE}${path}`, { method });',
        'export const remote = (path: string) => fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`);',
        '',
      ].join('\n'),
      '/src/Panel.tsx': `
        import { request, remote } from './request';
        export const Panel = () => {
          const load = () => { request('/orders', 'POST'); remote('/users'); };
          return <button onClick={load} />;
        };
      `,
    });
    expect(addresses(graph)).toEqual(['GET ${NEXT_PUBLIC_API_URL}/users', 'POST /api/orders']);
  });
});
