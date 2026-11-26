import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';
import { pageNameOf } from './navigation.js';

const FIXTURES = join(resolve(import.meta.dirname, '../../../..'), 'fixtures');

const read = (dir: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: dir,
    repo: 'web',
    service: { name: 'web', repo: dir, type: 'nuxt' },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-09T00:00:00.000Z',
  });

/** Each `calls` edge whose meta carries `key`, as `from -> to` by file and name. */
const drawn = (graph: RepoGraph, key: string): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.[key] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]}`)
    .sort();

const rowsOf = (graph: RepoGraph, reason: string): Array<{ symbol: string; why: unknown }> =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .flatMap((row) => {
      const causes = row.meta?.['causes'] as Array<{ samples: Array<{ symbol?: string; meta?: Record<string, unknown> }> }> | undefined;
      return causes === undefined
        ? [{ symbol: row.symbol ?? '', why: row.meta?.['why'] }]
        : causes.flatMap((part) => part.samples.map((sample) => ({ symbol: sample.symbol ?? '', why: sample.meta?.['why'] ?? row.meta?.['why'] })));
    })
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

describe("a page's navigations and a middleware the root component adds once mounted (P265)", () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'nuxt-navigation', 'shop'));
  }, 60000);

  it('joins a path, a template of one, a name Nuxt gives a file, a name a page writes, a link, and a redirect to the page each shows', () => {
    expect(drawn(graph, 'navigates')).toEqual([
      'app/middleware/auth.ts:auth -> app/pages/login.vue:login',
      // From the function that navigates: a handler of the page, or the page for a link in its template.
      'app/pages/index.vue:open -> app/pages/orders/[id].vue:orders/[id]',
      'app/pages/index.vue:pages/index -> app/pages/orders/index.vue:orders/index',
      'app/pages/index.vue:pages/index -> app/pages/receipts/[id].vue:receipts/[id]',
      'app/pages/login.vue:done -> app/pages/index.vue:pages/index',
      'app/pages/orders/[id].vue:orders/[id] -> app/pages/orders/index.vue:orders/index',
      'app/pages/orders/index.vue:orders/index -> app/pages/index.vue:pages/index',
      'app/pages/orders/index.vue:show -> app/pages/orders/[id].vue:orders/[id]',
    ]);
    const redirect = graph.edges.find((edge) => edge.meta?.['navigates'] === '/login');
    expect(redirect?.meta).toMatchObject({ route: '/login', redirects: true });
    expect(graph.edges.find((edge) => edge.meta?.['navigates'] === 'orders-id')?.meta).toMatchObject({ byName: true });
    expect(graph.edges.find((edge) => edge.meta?.['navigates'] === '/')?.meta).toMatchObject({ replace: true });
    expect(graph.edges.find((edge) => edge.meta?.['navigates'] === '/orders/${id}')?.meta).toMatchObject({ page: 'app/pages/orders/[id].vue' });
  });

  it('says an address out of the application, one no page shows, and one written as code', () => {
    expect(rowsOf(graph, 'navigation-external').map((row) => row.symbol)).toEqual(['pay navigates to https://pay.example.com/checkout']);
    expect(rowsOf(graph, 'navigation-unresolved')).toEqual([
      { symbol: 'go navigates to to', why: 'dynamic' },
      { symbol: 'lost navigates to /archive', why: 'missing' },
    ]);
  });

  it('records `abortNavigation` on the middleware that calls it', () => {
    expect(graph.nodes.find((node) => node.id.endsWith('app/middleware/auth.ts:auth'))?.meta).toMatchObject({ abortsNavigation: true });
  });

  it("runs a middleware `onMounted` adds in the root component in front of every page, once mounted, after the first navigation", () => {
    const added = graph.edges.filter((edge) => edge.meta?.['middleware'] === 'app middleware');
    expect(added.length).toBeGreaterThan(0);
    expect(added[0]?.meta).toMatchObject({ setup: 'app/app.vue', addedIn: 'app/app.vue', firstNavigation: false, mounted: true });
    expect(rowsOf(graph, 'route-middleware-unresolved')).toEqual([]);
  });

  it.each([
    ['app/pages/index.vue', 'index'],
    ['app/pages/orders/index.vue', 'orders'],
    ['app/pages/orders/[id].vue', 'orders-id'],
    ['pages/(shop)/carts/[[step]].vue', 'carts-step'],
    ['pages/docs/[...slug].vue', 'docs-slug'],
    ['app/views/home.vue', undefined],
  ])('names %s as Nuxt does', (file, name) => {
    expect(pageNameOf(file)).toBe(name);
  });
});
