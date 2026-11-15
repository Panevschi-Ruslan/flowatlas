import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'registry-reach-views-handed-links');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-15T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates) confidence [through wrapper]`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => {
      const wrapper = edge.meta?.['wrapper'];
      const also = edge.meta?.['alsoNavigates'];
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])}${Array.isArray(also) ? `, ${also.join(', ')}` : ''}) ${edge.confidence}${typeof wrapper === 'string' ? ` through ${wrapper}` : ''}`;
    })
    .sort();

/** Each screen placed at an address, as `screen route`. */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => typeof node.meta?.['route'] === 'string')
    .map((node) => `${node.id.split(':').pop()} ${String(node.meta?.['route'])}`)
    .sort();

/** Each row of a reason, as `file symbol (why)`. */
const rows = (graph: RepoGraph, reason: string): string[] =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .map((row) => `${row.file} ${row.symbol} (${String((row.meta as Record<string, unknown> | undefined)?.['why'] ?? '')})`)
    .sort();

describe("a module's store added to from other modules, a registry handing back a view of its entries, and a link prop every use hands a value (P314)", () => {
  let consoleGraph: RepoGraph;
  let site: RepoGraph;
  beforeAll(async () => {
    [consoleGraph, site] = await Promise.all([read('console', 'react'), read('site', 'nextjs')]);
  }, 120000);

  it("follows a module's store wherever the repository names it, and reads each entry through the view its reader hands back", () => {
    expect(routes(consoleGraph)).toEqual([
      // `addPage` in another module sets the exported `pages`; `listPages` hands back `[...pages.values()]`.
      'Billing /billing',
      // `PluginRegistry.routes()` maps each plugin to `{ ...plugin, path: `/plugins${plugin.path}` }`.
      'Calendar /plugins/calendar',
      // `allReports()` hands back `Object.values(reports)`.
      'Sales /reports/sales',
      // `allPages.set(...)` outside any function, the store imported under another name.
      'Team /team',
      // `consolePanels()` maps each panel to `{ ...panel, path: BASE + panel.path }`.
      'Usage /console/usage',
    ]);
  });

  it("does not take the entries of a view it cannot read as they are, and says so where a navigation lands nowhere", () => {
    // `toolRoutes()` hands back `tools.map(toRoute)`: the tool's route is not `/export`, and it is counted as not read.
    expect(routes(consoleGraph).some((each) => each.startsWith('Exporter'))).toBe(false);
    expect(rows(consoleGraph, 'navigation-unresolved')).toEqual(['src/App.tsx App navigates to /tools/export (unplaced)']);
  });

  it("reads a link prop of another name every use hands as a value, one navigation per value read, and a row for a value not read", () => {
    expect(navigations(site)).toEqual([
      // `FOOTER.map((entry) => <Link href={entry.href}>)`: Next's own link, one navigation per entry with an address.
      'src/components/Footer.tsx:Footer -> src/app/legal/page.tsx:LegalPage (/legal) static',
      'src/components/Footer.tsx:Footer -> src/app/status/page.tsx:StatusPage (/status) static',
      // `LINKS.map((item) => <NavLink to={item.path}>)` and `<NavLink to={CAREERS}>`: never text, each value read.
      'src/components/Menu.tsx:Menu -> src/app/[locale]/about/page.tsx:AboutPage (/${locale}/about) static through NavLink',
      'src/components/Menu.tsx:Menu -> src/app/[locale]/careers/page.tsx:CareersPage (/${locale}/careers) static through NavLink',
      'src/components/Menu.tsx:Menu -> src/app/[locale]/pricing/page.tsx:PricingPage (/${locale}/pricing) static through NavLink',
      // `/tags/t-${name}`: the prop is glued into a segment and its one value is not read, so the component navigates.
      'src/components/TagLink.tsx:TagLink -> src/app/tags/[tag]/page.tsx:TagPage (/tags/t-${name}) static',
    ]);
    // `<LocaleLink target={params.get('next')}>`: put after `/${locale}`, the prop is an address; its value is not read, and that is said where it is handed.
    expect(rows(site, 'navigation-unresolved')).toEqual(["src/components/Back.tsx Back navigates to params.get('next') (dynamic)"]);
  });
});
