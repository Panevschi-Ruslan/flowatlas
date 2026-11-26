import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'locale-links-registries-sdk-grpc');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-14T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates) confidence [through wrapper]`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => {
      const wrapper = edge.meta?.['wrapper'];
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])}) ${edge.confidence}${typeof wrapper === 'string' ? ` through ${wrapper}` : ''}`;
    })
    .sort();

/** Each request, as `from -> label`. */
const requests = (graph: RepoGraph): string[] => {
  const labels = new Map(graph.nodes.filter((node) => node.type === 'ui_api_call').map((node) => [node.id, node.label]));
  return graph.edges
    .filter((edge) => edge.type === 'calls' && labels.has(edge.to))
    .map((edge) => `${edge.from.split('#')[1]} -> ${labels.get(edge.to)}`)
    .sort();
};

const routeOf = (graph: RepoGraph, id: string): unknown => graph.nodes.find((node) => node.id.endsWith(id))?.meta?.['route'];

describe("an application's own links, a registry's entries, declared locales, requests in class methods, compositions (P297)", () => {
  let wiki: RepoGraph;
  let site: RepoGraph;
  let portal: RepoGraph;
  beforeAll(async () => {
    [wiki, site, portal] = await Promise.all([read('wiki', 'react'), read('site', 'nextjs'), read('portal', 'nextjs')]);
  }, 120000);

  it("places a route per entry a registry of the repository's own holds, read off the element each entry is written over", () => {
    // `PluginManager.getHooks(Hook.Settings).forEach((plugin) => items.splice(..., { path: ..., component: plugin.value.component.Component }))`.
    expect(routeOf(wiki, 'src/plugins/calendar/client/Settings.tsx:CalendarSettings')).toBe('/settings/integrations/calendar');
    expect(routeOf(wiki, 'src/plugins/audit/client/Settings.tsx:AuditSettings')).toBe('/settings/audit');
    // Added under another hook: no settings route.
    expect(routeOf(wiki, 'src/plugins/emoji/client/Settings.tsx:EmojiSettings')).toBeUndefined();
    expect(wiki.unresolved.filter((row) => row.reason === 'navigation-unresolved')).toEqual([]);
  });

  it("reads a link of the application's own through to the link it renders", () => {
    expect(navigations(wiki)).toEqual([
      'src/components/Header.tsx:Header -> src/plugins/audit/client/Settings.tsx:AuditSettings (/settings/audit) static',
      'src/components/Header.tsx:Header -> src/plugins/calendar/client/Settings.tsx:CalendarSettings (/settings/integrations/calendar) static',
      // `<HelpLink to="/billing">` renders `<Link to={`/help${to}`}>`.
      'src/components/Header.tsx:Header -> src/screens/HelpBilling.tsx:HelpBilling (/help/billing) static through HelpLink',
    ]);
    expect(navigations(site)).toEqual([
      // A locale the site declares, written out.
      'src/components/Footer.tsx:Footer -> src/app/[locale]/page.tsx:HomePage (/fr) static through LangLink',
      // `<Button href>` renders `<LangLink href>`, which hands `withLang(locale, href)` to Next's link: the locale is put in front.
      'src/components/Footer.tsx:Footer -> src/app/[locale]/partners/page.tsx:PartnersPage (/partners) heuristic through Button',
      // `styled(LangLink)`.
      'src/components/Footer.tsx:Footer -> src/app/[locale]/pricing/page.tsx:PricingPage (/pricing) heuristic through LangLink',
    ]);
    const notes = site.unresolved.filter((row) => row.reason === 'navigation-locale-prefixed');
    expect(notes.map((row) => row.meta?.['localizedBy'] ?? (row.meta?.['causes'] as Array<{ samples: Array<{ meta?: Record<string, unknown> }> }> | undefined)?.[0]?.samples[0]?.meta?.['localizedBy'])).not.toContain(undefined);
    // The link inside the wrapper is handed the wrapper's prop: its uses navigate, it says nothing of its own.
    expect(site.unresolved.filter((row) => row.reason === 'navigation-unresolved')).toEqual([]);
  });

  it('takes a first segment for a locale only where it is one the application declares', () => {
    expect(navigations(portal)).toEqual([
      // `go` is shaped like a locale and is none of `en`, `de`: the address is written without one.
      'src/components/Nav.tsx:Nav -> src/app/[locale]/go/[plan]/page.tsx:PlanPage (/go/pricing) heuristic',
      'src/components/Nav.tsx:Nav -> src/app/[locale]/pricing/page.tsx:PricingPage (/de/pricing) static',
    ]);
  });

  it("reads a request written in a class method's own body, and one made through Remeda's pipe and a module's default composition", () => {
    expect(requests(wiki)).toEqual([
      'src/components/Header.tsx:Header -> GET /api/members',
      'src/components/Header.tsx:Header -> GET /api/teams',
      'src/stores/ActivityStore.ts:ActivityStore.load -> GET /api/activity',
      'src/stores/ActivityStore.ts:ActivityStore.remove -> DELETE /api/activity/:param',
    ]);
  });
});
