import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'front-end-navigations');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-09T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to` by file and name. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
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

describe("a front end's navigations, whichever router it uses (P276)", () => {
  let storefront: RepoGraph;
  let shop: RepoGraph;
  let backoffice: RepoGraph;
  let kiosk: RepoGraph;
  beforeAll(async () => {
    [storefront, shop, backoffice, kiosk] = await Promise.all([read('storefront', 'react'), read('shop', 'nextjs'), read('backoffice', 'vue'), read('kiosk', 'sveltekit')]);
  }, 120000);

  it("joins React Router's `navigate`, `<Link to>`, `<NavLink>`, the data router's `navigate` and a loader's `redirect`", () => {
    expect(navigations(storefront)).toEqual([
      'src/main.tsx:accountLoader -> src/pages/Login.tsx:Login',
      'src/main.tsx:signOut -> src/pages/Login.tsx:Login',
      'src/pages/Home.tsx:Home -> src/pages/Login.tsx:Login',
      'src/pages/Home.tsx:Home -> src/pages/OrderDetail.tsx:OrderDetail',
      'src/pages/Home.tsx:Home -> src/pages/Orders.tsx:Orders',
      // The older forms: `useHistory().push`, `<Route component>`, `<Redirect to>`, and `<Navigate to>`.
      'src/pages/Legacy.tsx:Gate -> src/pages/Login.tsx:Login',
      'src/pages/Legacy.tsx:Legacy -> src/pages/Orders.tsx:Orders',
      'src/pages/Legacy.tsx:LegacyRoutes -> src/pages/Legacy.tsx:Legacy',
      'src/pages/OrderDetail.tsx:OrderDetail -> src/pages/Orders.tsx:Orders',
      'src/pages/Orders.tsx:Orders -> src/pages/Home.tsx:Home',
      'src/pages/Orders.tsx:Orders -> src/pages/OrderDetail.tsx:OrderDetail',
    ]);
    const redirect = storefront.edges.find((edge) => edge.from.endsWith(':accountLoader') && edge.meta?.['navigates'] !== undefined);
    expect(redirect?.meta).toMatchObject({ navigates: '/login', route: '/login', redirects: true });
    expect(storefront.edges.find((edge) => edge.from.endsWith(':signOut'))?.meta).toMatchObject({ replace: true });
    expect(storefront.edges.find((edge) => edge.meta?.['link'] === 'NavLink')?.meta).toMatchObject({ navigates: '/login' });
    expect(storefront.edges.find((edge) => edge.meta?.['link'] === 'Navigate')?.meta).toMatchObject({ redirects: true, replace: true });
    expect(storefront.edges.find((edge) => edge.meta?.['link'] === 'Redirect')?.meta).toMatchObject({ navigates: '/legacy', redirects: true });
  });

  it('says an address out of the application, one no screen shows and one written as code, and nothing for a step back', () => {
    expect(rowsOf(storefront, 'navigation-external').map((row) => row.symbol)).toEqual(['Home navigates to https://help.example.com/storefront']);
    expect(rowsOf(storefront, 'navigation-unresolved').map((row) => row.symbol)).toEqual([
      'Home navigates to ${window.location.origin}/orders',
      'Home navigates to /archive',
      'Home navigates to next',
    ]);
    // No placed screen shows `/archive`, and one route's path is built by a
    // function: the page may be that one, so it is said (info), not accused
    // (action) - and folded with the two written as code, every row is info.
    const levels = storefront.unresolved.filter((row) => row.reason === 'navigation-unresolved').map((row) => row.level);
    expect(levels).toEqual(['info']);
    // `/orders${search}`: the query glued to the last segment, the orders page.
    expect(rowsOf(storefront, 'navigation-unresolved').some((row) => row.symbol.includes('search'))).toBe(false);
  });

  it("joins Next's router, `push` taken out of it, its `Router`, `<Link href>` by path and by pathname, and a server component's `redirect`", () => {
    expect(navigations(shop)).toEqual([
      'app/account/page.tsx:AccountPage -> pages/orders/index.tsx:OrdersPage',
      // `router.push('/account')` lands on the newer router's page.
      'pages/index.tsx:HomePage -> app/account/page.tsx:AccountPage',
      'pages/index.tsx:HomePage -> pages/orders/[id].tsx:OrderPage',
      'pages/index.tsx:HomePage -> pages/orders/index.tsx:OrdersPage',
      'pages/orders/[id].tsx:OrderPage -> pages/orders/index.tsx:OrdersPage',
      'pages/orders/index.tsx:OrdersPage -> pages/orders/[id].tsx:OrderPage',
    ]);
    expect(shop.edges.find((edge) => edge.from.endsWith(':AccountPage') && edge.meta?.['navigates'] !== undefined)?.meta).toMatchObject({ redirects: true });
    expect(rowsOf(shop, 'navigation-unresolved')).toEqual([]);
    expect(shop.nodes.find((node) => node.id.endsWith('pages/orders/[id].tsx:OrderPage'))?.meta).toMatchObject({ route: '/orders/:param' });
  });

  it("joins Vue Router's `push` by name and by path, `this.$router`, a router imported from where it is made, and `<RouterLink>`", () => {
    expect(navigations(backoffice)).toEqual([
      'src/router/index.ts:goHome -> src/views/HomeView.vue:HomeView',
      'src/views/HomeView.vue:HomeView -> src/views/StockView.vue:StockView',
      'src/views/HomeView.vue:openItem -> src/views/StockItem.vue:StockItem',
      'src/views/StockView.vue:StockView.open -> src/views/StockItem.vue:StockItem',
    ]);
    expect(backoffice.edges.find((edge) => edge.meta?.['navigates'] === 'stock-item')?.meta).toMatchObject({ byName: true });
    expect(rowsOf(backoffice, 'navigation-unresolved')).toEqual([{ symbol: 'StockView.close navigates to missing-screen', why: 'missing' }]);
  });

  it("joins SvelteKit's `goto`", () => {
    expect(navigations(kiosk)).toContain('src/routes/+page.svelte:start -> src/routes/menu/+page.svelte:menu/+page');
    expect(kiosk.edges.find((edge) => edge.meta?.['navigates'] === '/menu')?.meta).toMatchObject({ replace: true });
  });
});
