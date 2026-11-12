import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AdapterRegistry, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const WEB = join(FIXTURES, 'vue-spa', 'web');

let graph: RepoGraph;
beforeAll(async () => {
  graph = await extractRepo({
    rootDir: WEB,
    repo: 'web',
    service: { name: 'web', repo: WEB, type: 'vue', apiBaseEnv: ['VITE_API_URL'] },
    registry: registerFrontendAdapters(new AdapterRegistry()),
    generatedAt: '2026-11-05T00:00:00.000Z',
  });
}, 60000);

const node = (id: string): GraphNode | undefined => graph.nodes.find((each) => each.id === id);
const edgesFrom = (id: string, type: string): string[] => graph.edges.filter((edge) => edge.from === id && edge.type === type).map((edge) => edge.to);

describe('Vue components, read from their files (P233)', () => {
  it('makes each component a screen at the address its router gives it', () => {
    expect(node('web#src/views/OrdersView.vue:OrdersView')).toMatchObject({ type: 'ui_component', file: 'src/views/OrdersView.vue', meta: { route: '/orders' } });
    // A child route, loaded lazily, at its parent's path and its own.
    expect(node('web#src/views/OrderDetail.vue:OrderDetail')?.meta?.['route']).toBe('/orders/:param');
  });

  it('draws a click to the function of the script, the method of the Options API, and the action of the store', () => {
    expect(edgesFrom('ui_action:web#src/views/OrdersView.vue:4:13', 'handles')).toEqual(['web#src/views/OrdersView.vue:refresh']);
    expect(edgesFrom('ui_action:web#src/views/OrdersView.vue:6:13', 'handles')).toEqual(['web#src/stores/orders.ts:useOrdersStore.add']);
    expect(edgesFrom('ui_action:web#src/views/OrderDetail.vue:4:13', 'handles')).toEqual(['web#src/views/OrderDetail.vue:OrderDetail.cancel']);
    // The call to what the composable handed back goes into the composable.
    expect(edgesFrom('web#src/views/OrdersView.vue:refresh', 'calls')).toContain('web#src/composables/useOrders.ts:useOrders');
    // Typing in the field is not a way in.
    expect(graph.nodes.filter((each) => each.type === 'ui_action' && each.label.startsWith('@input'))).toEqual([]);
  });

  it('reads the requests a component and its store make, as the React reader reads them', () => {
    expect(edgesFrom('web#src/views/OrderDetail.vue:OrderDetail.cancel', 'calls')).toEqual(['ui_api_call:web#src/views/OrderDetail.vue:18:13']);
    expect(node('ui_api_call:web#src/views/OrderDetail.vue:18:13')?.meta).toMatchObject({ method: 'POST', path: '/orders/:param/cancel', url: '${VITE_API_URL}/orders/:param/cancel', baseUrlEnv: 'VITE_API_URL' });
    expect(node('ui_api_call:web#src/composables/useOrders.ts:7:26')?.meta).toMatchObject({ method: 'GET', path: '/orders', baseUrlEnv: 'VITE_API_URL' });
  });

  it('says when a handler names nothing the component has', () => {
    expect(graph.unresolved.filter((row) => row.reason === 'template-handler-not-found')).toMatchObject([
      { file: 'src/views/OrdersView.vue', line: 7, level: 'action' },
    ]);
  });

  it('never names the file it made up for the checker', () => {
    expect(JSON.stringify(graph)).not.toMatch(/\.vue\.tsx?|__flowatlasComponent__/);
  });
});

/** Every position the three fixtures' graphs record in a component file names that file at a line it has, and a click names its binding's column. */
describe('positions in component files (P233)', () => {
  for (const [fixture, repos] of [
    ['vue-spa', { web: 'web' }],
    ['nuxt-full-stack', { shop: 'shop' }],
    ['svelte-components', { shop: 'shop' }],
  ] as const) {
    it(`agree with the files of ${fixture}`, () => {
      const snapshot = JSON.parse(readFileSync(join(FIXTURES, fixture, 'expected.project-graph.json'), 'utf8')) as RepoGraph;
      const placed = snapshot.nodes.filter((each) => each.file !== undefined && /\.(vue|svelte)$/.test(each.file));
      expect(placed.length).toBeGreaterThan(0);
      for (const each of placed) {
        const dir = (repos as Record<string, string>)[each.repo] as string;
        const lines = readFileSync(join(FIXTURES, fixture, dir, each.file as string), 'utf8').split('\n');
        expect(each.line, each.id).toBeLessThanOrEqual(lines.length);
        if (each.type !== 'ui_action') continue;
        const column = Number(each.id.split(':').pop());
        const binding = String(each.meta?.['event'] ?? '');
        expect(lines[(each.line as number) - 1]?.slice(column - 1), each.id).toMatch(new RegExp(`^(@|v-on:|on:|on|\\{\\s*on)${binding}`));
      }
    });
  }
});
