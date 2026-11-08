import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURES = join(resolve(import.meta.dirname, '../../../..'), 'fixtures');

const read = (dir: string, type: 'vue' | 'nuxt' | 'sveltekit'): Promise<RepoGraph> =>
  extractRepo({
    rootDir: dir,
    repo: 'web',
    service: { name: 'web', repo: dir, type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-08T00:00:00.000Z',
  });

/** Each `calls` edge whose meta carries `key`, as `from -> to` by file and name, with its place in the order. */
const drawn = (graph: RepoGraph, key: string): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.[key] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]}${typeof edge.meta?.['order'] === 'number' ? ` @${edge.meta['order']}` : ''}`)
    .sort();

const rowsOf = (graph: RepoGraph, reason: string): Array<{ symbol: string; message: string }> =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .flatMap((row) => {
      const causes = row.meta?.['causes'] as Array<{ samples: Array<{ symbol?: string; message?: string }> }> | undefined;
      return causes === undefined
        ? [{ symbol: row.symbol ?? '', message: row.message ?? '' }]
        : causes.flatMap((part) => part.samples.map((sample) => ({ symbol: sample.symbol ?? '', message: sample.message ?? row.message ?? '' })));
    });

describe('components a Vue plugin registers, and ones loaded later (P258)', () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'vue-plugins', 'web'), 'vue');
  }, 60000);

  it('joins `defineAsyncComponent` held in a name, in `components: {}` with a loader, and registered for every template, and what a plugin of the repository registers', () => {
    expect(drawn(graph, 'renders')).toEqual([
      'src/components/OrderChart.vue:OrderChart -> src/components/ChartLegend.vue:ChartLegend',
      'src/views/OrdersView.vue:OrdersView -> src/components/AppBadge.vue:AppBadge',
      'src/views/OrdersView.vue:OrdersView -> src/components/OrderChart.vue:OrderChart',
      'src/views/OrdersView.vue:OrdersView -> src/components/OrderTable.vue:OrderTable',
    ]);
  });

  it("leaves a known library's tags and a package's registered component to them, and says which plugin may register a tag that names nothing", () => {
    const rows = rowsOf(graph, 'component-unresolved');
    expect(rows.map((row) => row.symbol)).toEqual(['OrdersView <KitPanel>']);
    expect(rows[0]?.message).toContain('app.use(UiKit) in src/main.ts may register it');
  });
});

describe('route middleware a Nuxt plugin adds when the application starts (P258)', () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'nuxt-plugins-tasks', 'shop'), 'nuxt');
  }, 60000);

  it('runs every global one in front of every page, in the order the plugins add them, then the ones a page names, a module plugin\'s among them', () => {
    expect(drawn(graph, 'middleware')).toEqual([
      'app/pages/index.vue:pages/index -> app/plugins/guards.ts:audit @1',
      'app/pages/index.vue:pages/index -> app/plugins/guards.ts:guards middleware @0',
      'app/pages/orders.vue:orders -> app/plugins/guards.ts:audit @1',
      'app/pages/orders.vue:orders -> app/plugins/guards.ts:guards middleware @0',
      'app/pages/orders.vue:orders -> app/plugins/guards.ts:signed-in @2',
      'app/pages/orders.vue:orders -> modules/reports/runtime/plugin.ts:reports-only @3',
    ]);
  });

  it('says a middleware added under a name written as code, and leaves a library a plugin installs to itself', () => {
    expect(rowsOf(graph, 'route-middleware-unresolved').map((row) => row.symbol)).toEqual(['app/plugins/guards.ts middleware useRuntimeConfig().public.guardName']);
    expect(rowsOf(graph, 'component-unresolved')).toEqual([]);
  });
});

describe("a SvelteKit page's layouts and loads (P258)", () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'sveltekit-layouts', 'shop'), 'sveltekit');
  }, 60000);

  it('goes through every layout up the route tree, the server loads first, then the universal ones, then the components, the root outermost', () => {
    const pages = [...drawn(graph, 'layout'), ...drawn(graph, 'load')];
    expect([...new Set(pages)].filter((edge) => edge.startsWith('src/routes/(app)/orders/[id]/+page.svelte')).sort()).toEqual([
      'src/routes/(app)/orders/[id]/+page.svelte:[id]/+page -> src/routes/(app)/+layout.svelte:(app)/+layout @4',
      'src/routes/(app)/orders/[id]/+page.svelte:[id]/+page -> src/routes/(app)/+layout.ts:load @1',
      'src/routes/(app)/orders/[id]/+page.svelte:[id]/+page -> src/routes/(app)/orders/[id]/+page.ts:load @2',
      'src/routes/(app)/orders/[id]/+page.svelte:[id]/+page -> src/routes/+layout.server.ts:load @0',
      'src/routes/(app)/orders/[id]/+page.svelte:[id]/+page -> src/routes/+layout.svelte:routes/+layout @3',
    ]);
  });

  it('resets to the layout a `@` names, for a page and for a layout, and says a reset that names no directory above', () => {
    const layouts = drawn(graph, 'layout');
    expect(layouts.filter((edge) => edge.includes('receipt'))).toEqual([
      'src/routes/(app)/orders/[id]/receipt/+page@.svelte:receipt/+page@ -> src/routes/+layout.server.ts:load @0',
      'src/routes/(app)/orders/[id]/receipt/+page@.svelte:receipt/+page@ -> src/routes/+layout.svelte:routes/+layout @1',
    ]);
    expect(layouts.filter((edge) => edge.startsWith('src/routes/(app)/print/'))).toEqual([
      'src/routes/(app)/print/+page.svelte:print/+page -> src/routes/(app)/print/+layout@.svelte:print/+layout@ @2',
      'src/routes/(app)/print/+page.svelte:print/+page -> src/routes/+layout.server.ts:load @0',
      'src/routes/(app)/print/+page.svelte:print/+page -> src/routes/+layout.svelte:routes/+layout @1',
    ]);
    expect(rowsOf(graph, 'layout-unresolved').map((row) => row.symbol)).toEqual(['broken/+page@(shop) layout @(shop)']);
  });
});
