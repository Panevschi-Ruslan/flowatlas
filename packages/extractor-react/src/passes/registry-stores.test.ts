import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'registry-stores-address-props-vite');

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
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])}) ${edge.confidence}${typeof wrapper === 'string' ? ` through ${wrapper}` : ''}`;
    })
    .sort();

/** Each screen placed at an address, as `screen route`. */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => typeof node.meta?.['route'] === 'string')
    .map((node) => `${node.id.split(':').pop()} ${String(node.meta?.['route'])}`)
    .sort();

describe("a registry whose store no class keeps, and a link's address handed in under another name (P303)", () => {
  let docs: RepoGraph;
  let handbook: RepoGraph;
  beforeAll(async () => {
    [docs, handbook] = await Promise.all([read('docs', 'react'), read('handbook', 'nextjs')]);
  }, 120000);

  it("places a route per entry a module's Map, a store handed in, and an object's own field hold, filtered by the key each is read by", () => {
    expect(routes(docs)).toEqual([
      // `sectionsOf('docs')`: `sections.get(area)` over a module's Map, `registerSection` filing by `section.area`; `Billing` is filed under `account`.
      'Guides /docs/guides',
      // `panels.all()`: `this.items`, which `panels.add` pushes onto.
      'Usage /dashboard/usage',
      // `entriesIn(adminEntries, 'people')`: `store.filter((entry) => entry.group === group)`; `Reports` is in another group, `Archive` in another store.
      'Users /admin/users',
    ]);
    expect(docs.unresolved.filter((row) => row.reason === 'navigation-unresolved')).toEqual([]);
  });

  it("reads a link whose address prop is put after the locale under another name through to the link it renders, and not one whose prop is a segment", () => {
    expect(navigations(handbook)).toEqual([
      // `<NavLink to="/about">` renders `<Link href={`/${locale}${to}`}>`.
      'src/components/Menu.tsx:Menu -> src/app/[locale]/about/page.tsx:AboutPage (/${locale}/about) static through NavLink',
      'src/components/Menu.tsx:Menu -> src/app/[locale]/pricing/page.tsx:PricingPage (/${locale}/pricing) static through NavLink',
      // `/orders/${id}`: the prop starts a segment of its own, so the component navigates.
      'src/components/OrderLink.tsx:OrderLink -> src/app/orders/[id]/page.tsx:OrderPage (/orders/${id}) static',
      // `/tags/t-${name}`: its uses write a name, not an address.
      'src/components/TagLink.tsx:TagLink -> src/app/tags/[tag]/page.tsx:TagPage (/tags/t-${name}) static',
    ]);
    expect(handbook.unresolved.filter((row) => row.reason === 'navigation-unresolved')).toEqual([]);
  });
});
