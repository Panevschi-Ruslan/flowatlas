import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'front-end-route-helpers');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-10T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates)` by file and name. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])})`)
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

const routeOf = (graph: RepoGraph, id: string): unknown => graph.nodes.find((node) => node.id.endsWith(id))?.meta?.['route'];

describe('routes written with path helpers and lazy screens, and navigations in markup (P288)', () => {
  let desk: RepoGraph;
  let sites: RepoGraph;
  let stand: RepoGraph;
  let panel: RepoGraph;
  beforeAll(async () => {
    [desk, sites, stand, panel] = await Promise.all([read('desk', 'react'), read('sites', 'nextjs'), read('stand', 'sveltekit'), read('panel', 'vue')]);
  }, 120000);

  it("places a route whose path a helper hands back and whose screen a lazy loader's object holds", () => {
    // `${startPath()}/:tab?`: both branches of the helper, the optional segment left out and put in.
    expect(routeOf(desk, 'src/screens/Home.tsx:Home')).toBe('/ /:param /home /home/:param');
    expect(desk.nodes.find((node) => node.id.endsWith('src/screens/Home.tsx:Home'))?.meta?.['routeGuessed']).toBe('/ /:param /home /home/:param');
    // `${findPath()}/:query?`: the query of the helper's answer is no part of the route.
    expect(routeOf(desk, 'src/screens/Search.tsx:Search')).toBe('/search /search/:param');
    expect(routeOf(desk, 'src/screens/Article.tsx:Article')).toBe('/a/:param');
    // `adminPath('teams', ':id', 'members')`: a rest parameter joined.
    expect(routeOf(desk, 'src/screens/TeamMembers.tsx:TeamMembers')).toBe('/admin/teams/:param/members');
    // `lazy(() => import('../screens/Login'))`, a module that hands on another's default export.
    expect(routeOf(desk, 'src/screens/Login/Login.tsx:Login')).toBe('/login');
  });

  it('joins a navigation whose address a helper hands back, through a history made by the history package', () => {
    expect(navigations(desk)).toEqual([
      'src/screens/Home.tsx:Home -> src/screens/Search.tsx:Search (/search)',
      'src/screens/Home.tsx:Home -> src/screens/TeamMembers.tsx:TeamMembers (/admin/teams/${team.id}/members)',
      // `startPath()` is `/` or `/home` as the build decides; both are the home screen, one edge, heuristic.
      'src/screens/Search.tsx:Search -> src/screens/Home.tsx:Home (/)',
    ]);
    const home = desk.edges.filter((edge) => edge.from.endsWith(':Search') && edge.meta?.['navigates'] !== undefined);
    expect(home.map((edge) => [edge.confidence, edge.meta?.['branch']])).toEqual([['heuristic', true]]);
    expect(rowsOf(desk, 'navigation-unresolved')).toEqual([{ symbol: 'Article navigates to pageUrl(parent)', why: 'dynamic' }]);
  });

  it("joins a navigation to its own application's page where two applications of one service have one", () => {
    expect(navigations(sites)).toEqual([
      'apps/blog/src/components/Header.tsx:Header -> apps/blog/src/app/(app)/[slug]/page.tsx:BlogPage (/)',
      'apps/blog/src/components/Header.tsx:Header -> apps/blog/src/app/(app)/search/page.tsx:SearchPage (/search)',
      // The store has no search page: its `/search` is a page by slug, the same page its `/` shows, not the blog's search.
      'apps/store/src/components/Header.tsx:Header -> apps/store/src/app/(app)/[slug]/page.tsx:StorePage (/)',
    ]);
    expect(rowsOf(sites, 'navigation-unresolved')).toEqual([]);
  });

  it("joins SvelteKit's plain links and a handler's `goto`, and says the rest", () => {
    expect(navigations(stand)).toEqual([
      'src/routes/+page.svelte:routes/+page -> src/routes/cart/+page.svelte:cart/+page (/cart)',
      'src/routes/+page.svelte:routes/+page -> src/routes/orders/+page.svelte:orders/+page (/orders)',
      'src/routes/+page.svelte:routes/+page -> src/routes/orders/[id]/+page.svelte:[id]/+page (/orders/${data.latest})',
    ]);
    expect(rowsOf(stand, 'navigation-external').map((row) => row.symbol)).toEqual(['routes/+page navigates to https://help.example.com/stand']);
    expect(rowsOf(stand, 'navigation-unresolved')).toEqual([{ symbol: 'orders/+page navigates to /missing-page', why: 'missing' }]);
  });

  it("joins Vue Router's `push` and `$router.replace` written in a template's handler", () => {
    expect(navigations(panel)).toEqual(['src/views/BoardView.vue:BoardView -> src/views/TicketsView.vue:TicketsView (/tickets)']);
    // `$router.replace({ name: 'board' })` lands on the page it is written in: no edge to itself, and no row.
    expect(rowsOf(panel, 'navigation-unresolved')).toEqual([]);
  });
});
