import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';
import { localePrefixOf } from '../util/locale-routing.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'front-end-route-branches');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-12T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates) confidence [also]`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => {
      const also = edge.meta?.['alsoNavigates'];
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])}) ${edge.confidence}${Array.isArray(also) ? ` also ${also.join(',')}` : ''}`;
    })
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

describe('route tables over a list, pages under a condition, a locale prefix, one edge per pair (P291)', () => {
  let wiki: RepoGraph;
  let site: RepoGraph;
  beforeAll(async () => {
    [wiki, site] = await Promise.all([read('wiki', 'react'), read('site', 'nextjs')]);
  }, 120000);

  it("places one page per entry of a list a route table is written over, through a hook, a memo, a filter and what is pushed onto it", () => {
    // `entries.map((entry) => <Route path={entry.path} component={entry.component} />)` over `useSettingsEntries()`.
    expect(routeOf(wiki, 'src/screens/settings/Profile.tsx:Profile')).toBe('/settings');
    expect(routeOf(wiki, 'src/screens/settings/Members.tsx:Members')).toBe('/settings/members');
    // `items.push({ ... })` after the array is written.
    expect(routeOf(wiki, 'src/screens/settings/Webhooks.tsx:Webhooks')).toBe('/settings/webhooks');
    // `extras.map(({ path, screen }) => <Route path={path} component={screen} />)`: names taken out of the item.
    expect(routeOf(wiki, 'src/screens/settings/Shortcuts.tsx:Shortcuts')).toBe('/settings/shortcuts');
    expect(routeOf(wiki, 'src/screens/settings/Tokens.tsx:Tokens')).toBe('/settings/tokens');
  });

  it('joins a navigation to each page a condition places at its address, and the inner page over the screen that holds its routes', () => {
    expect(navigations(wiki)).toEqual([
      // `env.PUBLIC_SHARE ? <Switch>SharedPage</Switch> : <Switch>SignIn</Switch>`, both at `/`: the build's two choices.
      'src/components/Header.tsx:Header -> src/screens/SharedPage.tsx:SharedPage (/) heuristic',
      'src/components/Header.tsx:Header -> src/screens/SignIn.tsx:SignIn (/) heuristic',
      // Two navigations to one page: one edge, every address kept.
      'src/components/Header.tsx:Header -> src/screens/Start.tsx:Start (/start) heuristic also /start/recent',
      'src/components/Header.tsx:Header -> src/screens/settings/Members.tsx:Members (/settings/members) static',
      // `/settings` is SettingsRoutes's address and the Profile entry's it places: the page.
      'src/components/Header.tsx:Header -> src/screens/settings/Profile.tsx:Profile (/settings) static',
      'src/components/Header.tsx:Header -> src/screens/settings/Tokens.tsx:Tokens (/settings/tokens) static',
      'src/components/Header.tsx:Header -> src/screens/settings/Webhooks.tsx:Webhooks (/settings/webhooks) static',
    ]);
    const branch = wiki.edges.find((edge) => edge.to.endsWith('SharedPage.tsx:SharedPage'));
    expect(branch?.meta?.['branch']).toBe(true);
    expect(rowsOf(wiki, 'navigation-unresolved')).toEqual([]);
  });

  it('joins an address written without the locale to the page under the segment the middleware adds', () => {
    expect(navigations(site)).toEqual([
      // The locale router's own `<Link href>` and `useRouter()`, imported under any name.
      'src/components/Footer.tsx:Footer -> src/app/[locale]/[slug]/page.tsx:ArticlePage (/about-us) heuristic',
      'src/components/Footer.tsx:Footer -> src/app/[locale]/search/page.tsx:SearchPage (/search) heuristic',
      // A page outside the locale segment answers as written.
      'src/components/Nav.tsx:Nav -> src/app/(admin)/admin/page.tsx:AdminPage (/admin) static',
      'src/components/Nav.tsx:Nav -> src/app/[locale]/[slug]/page.tsx:ArticlePage (/about-us) heuristic',
      // A locale written out fits the address as written.
      'src/components/Nav.tsx:Nav -> src/app/[locale]/page.tsx:FrontPage (/fr) static',
      // `page + 1` is a sum, one value.
      'src/components/Nav.tsx:Nav -> src/app/[locale]/posts/page/[pageNumber]/page.tsx:PostsPage (/posts/page/${page + 1}) heuristic',
      'src/components/Nav.tsx:Nav -> src/app/[locale]/search/page.tsx:SearchPage (/search) heuristic',
    ]);
    const search = site.edges.find((edge) => edge.to.endsWith('search/page.tsx:SearchPage'));
    expect(search?.meta?.['localePrefix']).toBe('[locale]');
    // One note per navigation joined across the prefix; the row keeps a few as samples.
    const notes = site.unresolved.filter((row) => row.reason === 'navigation-locale-prefixed');
    const sites = notes.flatMap((row) => (row.meta?.['causes'] as Array<{ sites: number }> | undefined) ?? [{ sites: 1 }]).reduce((sum, part) => sum + part.sites, 0);
    expect(sites).toBe(5);
    expect(rowsOf(site, 'navigation-locale-prefixed').map((row) => row.symbol)).toContain('Footer navigates to /search');
    expect(rowsOf(site, 'navigation-unresolved')).toEqual([]);
  });

  it('reads a locale prefix only where the application declares what adds it', () => {
    const repoDir = join(FIXTURE, 'site');
    expect(localePrefixOf(repoDir, 'src/app/[locale]/search/page.tsx', '/:param/search')).toBe('[locale]');
    // Not the first segment under the pages, or an application with no middleware and no locale router.
    expect(localePrefixOf(repoDir, 'src/app/(admin)/admin/page.tsx', '/admin')).toBeUndefined();
    expect(localePrefixOf(join(FIXTURE, 'wiki'), 'src/app/[locale]/search/page.tsx', '/:param/search')).toBeUndefined();
  });
});
