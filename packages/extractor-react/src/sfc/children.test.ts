import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURES = join(resolve(import.meta.dirname, '../../../..'), 'fixtures');

const read = (dir: string, type: 'vue' | 'nuxt'): Promise<RepoGraph> =>
  extractRepo({
    rootDir: dir,
    repo: 'web',
    service: { name: 'web', repo: dir, type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-08T00:00:00.000Z',
  });

/** Each `calls` edge a component's markup or a page's way through the router draws, as `from -> to` by file and name. */
const drawn = (graph: RepoGraph, key: 'renders' | 'middleware' | 'layout'): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.[key] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]}${typeof edge.meta?.['order'] === 'number' ? ` @${edge.meta['order']}` : ''}`)
    .sort();

const symbolsOf = (graph: RepoGraph, reason: string): string[] =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .flatMap((row) => {
      const causes = row.meta?.['causes'] as Array<{ samples: Array<{ symbol?: string }> }> | undefined;
      return causes === undefined ? [row.symbol ?? ''] : causes.flatMap((part) => part.samples.map((sample) => sample.symbol ?? ''));
    })
    .sort();

describe('the child components a Vue template renders (P255)', () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'vue-components', 'web'), 'vue');
  }, 60000);

  it('joins a tag by an import, the Options API, `app.component`, kebab-case and `<component :is>`', () => {
    expect(drawn(graph, 'renders')).toEqual([
      'src/App.vue:App -> src/components/AppIcon.vue:AppIcon',
      'src/components/OrderRow.vue:OrderRow -> src/components/RowActions.vue:RowActions',
      'src/views/OrdersView.vue:OrdersView -> src/components/AppIcon.vue:AppIcon',
      'src/views/OrdersView.vue:OrdersView -> src/components/CartSummary.vue:CartSummary',
      'src/views/OrdersView.vue:OrdersView -> src/components/OrderRow.vue:OrderRow',
    ]);
  });

  it('says a PascalCase tag that names nothing, and leaves a custom element and the router to themselves', () => {
    expect(symbolsOf(graph, 'component-unresolved')).toEqual(['OrdersView <ShippingNote>']);
  });
});

describe('what a Nuxt application registers by name (P255)', () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await read(join(FIXTURES, 'nuxt-components', 'shop'), 'nuxt');
  }, 60000);

  it("joins a tag to the file Nuxt names so: a prefix, `pathPrefix: false`, `Lazy`, both modes, a layer's, a module's", () => {
    expect(drawn(graph, 'renders')).toEqual([
      'app/layouts/default.vue:default -> app/components/SiteHeader.vue:SiteHeader',
      'app/pages/index.vue:pages/index -> ../base-layer/components/Rating.vue:Rating',
      'app/pages/index.vue:pages/index -> ../catalog-kit/src/runtime/components/SearchBox.vue:SearchBox',
      // The application's own, over the layer's of the same name.
      'app/pages/index.vue:pages/index -> app/components/CartBadge.vue:CartBadge',
      'app/pages/index.vue:pages/index -> app/components/Map.client.vue:components/Map.client',
      'app/pages/index.vue:pages/index -> app/components/Map.server.vue:components/Map.server',
      'app/pages/index.vue:pages/index -> app/components/ProductList.vue:ProductList',
      'app/pages/index.vue:pages/index -> app/components/base/Card.vue:Card',
      'app/pages/index.vue:pages/index -> app/components/flat/orders/OrderTotal.vue:OrderTotal',
      'app/pages/index.vue:pages/index -> app/components/ui/Button.vue:Button',
    ]);
    expect(symbolsOf(graph, 'component-unresolved')).toEqual(['pages/index <Mystery>']);
  });

  it('runs every page through the global middleware, then its own in order, then its layout', () => {
    expect(drawn(graph, 'middleware').filter((edge) => edge.startsWith('app/pages/admin.vue'))).toEqual([
      'app/pages/admin.vue:admin -> ../base-layer/middleware/locale.global.ts:locale-global @0',
      'app/pages/admin.vue:admin -> ../catalog-kit/src/runtime/guard.ts:catalog-guard @3',
      'app/pages/admin.vue:admin -> app/middleware/auth.ts:auth @2',
      'app/pages/admin.vue:admin -> app/middleware/track.global.ts:track-global @1',
    ]);
    expect(drawn(graph, 'layout')).toEqual([
      // The application's `admin` over the layer's, and `default` where a page names none.
      'app/pages/admin.vue:admin -> app/layouts/admin.vue:admin @4',
      'app/pages/index.vue:pages/index -> app/layouts/default.vue:default @2',
    ]);
  });

  it('says a middleware and a layout a page names that no file gives', () => {
    expect(symbolsOf(graph, 'route-middleware-unresolved')).toEqual(['admin middleware audit']);
    expect(symbolsOf(graph, 'layout-unresolved')).toEqual(['reports layout wide']);
  });
});
