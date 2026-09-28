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
 * Reads a repository written in memory, with a configuration of its own.
 *
 * The one thing the other reading test cannot do: the question here is what a
 * project's own configuration changes, so the configuration has to be an
 * argument rather than the empty one everything else is read with.
 */
const read = (files: Record<string, string>, declared: readonly string[] = []): RepoGraph => {
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
    config: parseConfig({ adapters: { frontend: { localClientClasses: [...declared] } } }),
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
  graph.nodes.filter((node) => node.type === 'ui_api_call');

const labels = (graph: RepoGraph): string[] => requests(graph).map((node) => node.label).sort();

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason);

/** A client whose verbs reach the browser's own client two members away. */
const WRAPPING_FETCH = `
  class ApiClient {
    private send = (path: string, method: string, body?: object) =>
      fetch(path, { method, body: JSON.stringify(body) });
    get = (path: string) => this.send(path, 'GET');
    post = (path: string, body?: object) => this.send(path, 'POST', body);
  }
  export const api = new ApiClient();
`;

describe('a client class the repository wrote itself', () => {
  it('is recognised when a verb of its own reaches the network', () => {
    const graph = read({
      '/src/api.ts': WRAPPING_FETCH,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => {
          const load = () => api.get('/api/orders');
          const create = () => api.post('/api/orders', { name: 'a' });
          return <button onClick={load} onDoubleClick={create} />;
        };
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/orders', 'POST /api/orders']);
    expect(requests(graph)[0]?.meta).toMatchObject({
      client: 'ApiClient',
      localClient: 'recognised',
      package: null,
    });
  });

  it('answers only to the verbs the class declares', () => {
    const graph = read({
      '/src/api.ts': WRAPPING_FETCH,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => <button onClick={() => api.put('/api/orders', {})} />;
      `,
    });
    // `put` is not a member of the class, so the call is not a request and the
    // reader has nothing to say about it either way.
    expect(requests(graph)).toHaveLength(0);
    expect(reasons(graph)).toEqual([]);
  });

  it('is not a client because it is spelled like one', () => {
    const graph = read({
      '/src/store.ts': `
        class DocumentsStore {
          private rows = new Map<string, object>();
          get = (id: string) => this.rows.get(id);
          delete = (id: string) => this.rows.delete(id);
        }
        export const documents = new DocumentsStore();
      `,
      '/src/Panel.tsx': `
        import { documents } from './store';
        export const Panel = () => <button onClick={() => documents.get('abc')} />;
      `,
    });
    expect(requests(graph)).toHaveLength(0);
    expect(reasons(graph)).toEqual([]);
  });

  it('says so where it is spelled like one and writes an address', () => {
    const graph = read({
      '/src/transport.ts': `
        export const send = (path: string, method: string) => fetch(path, { method });
      `,
      '/src/reports.ts': `
        import { send } from './transport';
        class ReportsClient {
          get = (path: string) => send(path, 'GET');
        }
        export const reports = new ReportsClient();
      `,
      '/src/Panel.tsx': `
        import { reports } from './reports';
        export const Panel = () => <button onClick={() => reports.get('/api/reports')} />;
      `,
    });
    expect(reasons(graph)).toContain('api-client-unread');
    const row = graph.unresolved.find((each) => each.reason === 'api-client-unread');
    expect(row?.hint).toContain('ReportsClient');
    expect(row?.hint).toContain('adapters.frontend.localClientClasses');
  });

  it('is read once the configuration names it, whatever the walk found', () => {
    const files = {
      '/src/transport.ts': `
        export const send = (path: string, method: string) => fetch(path, { method });
      `,
      '/src/billing.ts': `
        import { send } from './transport';
        export class BillingClient {
          put = (path: string, body?: object) => send(path, 'PUT', body);
        }
        export const billing = new BillingClient();
      `,
      '/src/Panel.tsx': `
        import { billing } from './billing';
        export const Panel = () => (
          <button onClick={() => billing.put('/api/invoices', { paid: true })} />
        );
      `,
    };
    // Undeclared, the transport's own unreadable request is all there is: the
    // class is a client and nothing here could prove it.
    expect(labels(read(files))).toEqual(['GET ?']);

    const graph = read(files, ['BillingClient']);
    expect(labels(graph)).toEqual(['GET ?', 'PUT /api/invoices']);
    const written = requests(graph).find((node) => node.label === 'PUT /api/invoices');
    expect(written?.meta).toMatchObject({
      client: 'BillingClient',
      localClient: 'declared',
    });
    expect(reasons(graph)).not.toContain('api-client-unread');
  });

  it('is read through a base class the configuration names', () => {
    const graph = read(
      {
        '/src/base.ts': `
          export class HttpBase {
            protected call = (path: string, method: string) => fetch(path, { method });
          }
        `,
        '/src/tags.ts': `
          import { HttpBase } from './base';
          class TagsClient extends HttpBase {
            get = (path: string) => this.call(path, 'GET');
          }
          export const tags = new TagsClient();
        `,
        '/src/Panel.tsx': `
          import { tags } from './tags';
          export const Panel = () => <button onClick={() => tags.get('/api/tags')} />;
        `,
      },
      ['HttpBase'],
    );
    expect(labels(graph)).toEqual(['GET /api/tags']);
    expect(requests(graph)[0]?.meta).toMatchObject({
      client: 'TagsClient',
      localClient: 'declared',
    });
  });
});

/**
 * The same client, holding the base every address it writes sits under.
 *
 * The shape the measured case is written in: the base is a field, set in the
 * constructor with a default beside it, and no call site mentions it. Every one
 * of them writes the tail alone.
 */
const WRAPPING_FETCH_UNDER_API = `
  type Options = { baseUrl?: string };
  class ApiClient {
    baseUrl: string;
    constructor(options: Options = {}) {
      this.baseUrl = options.baseUrl || '/api';
    }
    private send = (path: string, method: string, body?: object) =>
      fetch(this.baseUrl + path, { method, body: JSON.stringify(body) });
    get = (path: string) => this.send(path, 'GET');
    post = (path: string, body?: object) => this.send(path, 'POST', body);
  }
  export const api = new ApiClient();
`;

describe('the base a client of one own holds', () => {
  it('is part of every address written through it', () => {
    const graph = read({
      '/src/api.ts': WRAPPING_FETCH_UNDER_API,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => {
          const load = () => api.get('/documents.info');
          const save = () => api.post('/documents.update', { id: 'a' });
          return <button onClick={load} onDoubleClick={save} />;
        };
      `,
    });
    // Without the base the two addresses are missing their first segment, and a
    // route that carries it answers neither of them (R114).
    expect(labels(graph)).toEqual(['GET /api/documents.info', 'POST /api/documents.update']);
    expect(requests(graph)[0]?.meta).toMatchObject({
      client: 'ApiClient',
      localClient: 'recognised',
      path: '/api/documents.info',
      url: '/api/documents.info',
    });
  });

  it('keeps the settings key it is rooted at', () => {
    const graph = read({
      '/src/api.ts': `
        class ApiClient {
          private baseUrl = process.env.API_URL + '/api';
          private send = (path: string, method: string) =>
            fetch(this.baseUrl + path, { method });
          get = (path: string) => this.send(path, 'GET');
        }
        export const api = new ApiClient();
      `,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => <button onClick={() => api.get('/documents.info')} />;
      `,
    });
    expect(requests(graph)[0]?.meta).toMatchObject({
      baseUrlEnv: 'API_URL',
      path: '/api/documents.info',
    });
  });

  it('keeps a settings key that is the whole of it', () => {
    const graph = read({
      '/src/api.ts': `
        import env from './env';
        class ApiClient {
          private base = env.API_URL;
          private send = (path: string, method: string) => fetch(this.base + path, { method });
          get = (path: string) => this.send(path, 'GET');
        }
        export const api = new ApiClient();
      `,
      '/src/env.ts': `export default { API_URL: '' };`,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => <button onClick={() => api.get('/documents.info')} />;
      `,
    });
    // Nothing is in front of the path, so the address is unchanged — but the key
    // the base is rooted at is now on the node, which is what lets the
    // configuration say which service answers it.
    expect(requests(graph)[0]?.meta).toMatchObject({
      baseUrlEnv: 'API_URL',
      path: '/documents.info',
    });
  });

  it('is not put in front of an address the call site rooted itself', () => {
    const graph = read({
      '/src/api.ts': WRAPPING_FETCH_UNDER_API,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => (
          <button onClick={() => api.post('https://telemetry.example.com/events', {})} />
        );
      `,
    });
    // A path written under a host of its own is not relative to anything the
    // client holds, and `/api` in front of it would be an address nobody writes.
    expect(labels(graph)).toEqual(['POST /events']);
    expect(requests(graph)[0]?.meta).toMatchObject({ host: 'telemetry.example.com' });
  });

  it('leaves an address alone where the class holds no base', () => {
    const graph = read({
      '/src/api.ts': WRAPPING_FETCH,
      '/src/Panel.tsx': `
        import { api } from './api';
        export const Panel = () => <button onClick={() => api.get('/api/orders')} />;
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/orders']);
  });
});
