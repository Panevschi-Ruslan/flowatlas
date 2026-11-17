import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'pair-keys-instances');

/** Each screen placed at an address, as `screen route`. */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => typeof node.meta?.['route'] === 'string')
    .map((node) => `${node.id.split(':').pop()} ${String(node.meta?.['route'])}`)
    .sort();

/** Each navigation edge, as `from -> to (navigates)`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])})`)
    .sort();

describe("a [key, entry] pair's key, an entry handed beside the store, a receiver of several instances, and an instance made in place (P338)", () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await extractRepo({
      rootDir: join(FIXTURE, 'console'),
      repo: 'console',
      service: { name: 'console', repo: join(FIXTURE, 'console'), type: 'react' },
      registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
      generatedAt: '2026-11-17T00:00:00.000Z',
    });
  }, 120000);

  it("binds a pair's key to the key its entry is kept under, in a step and in a route written over the pairs", () => {
    expect(routes(graph)).toEqual(
      expect.arrayContaining([
        // `Object.entries(SCREENS).map(([path, Screen]) => <Route path={path} element={<Screen />} />)`.
        'Reports /reports',
        'Inbox /inbox',
        // `([path, { Screen }])`: a key of the entry.
        'Export /tools/export',
        // `([slug, page]) => ({ ...page, path: `/pages/${slug}` })`.
        'Intro /pages/intro',
        'Faq /pages/faq',
        // A reduce writing each team under `[team.slug]`, then `([slug, team])`.
        'Members /teams/members',
      ]),
    );
    // A link over the pairs' keys lands on each page.
    expect(navigations(graph)).toEqual(['src/App.tsx:Nav -> src/features/screens.tsx:Inbox (/inbox)', 'src/App.tsx:Nav -> src/features/screens.tsx:Reports (/reports)']);
  });

  it('reads an entry handed in the object the store is handed in, and each instance a prop is handed', () => {
    const placed = routes(graph);
    // `<WidgetRoutes registry={widgets} />` and `<WidgetRoutes registry={gadgets} />`, each filled by `install({ registry, widget })`.
    expect(placed).toContain('Chart /widgets/chart');
    expect(placed).toContain('Gauge /gadgets/gauge');
    // `spares` is handed to no use.
    expect(placed.some((each) => each.startsWith('Hidden '))).toBe(false);
  });

  it('reads an instance made in place as fresh, and a singleton made on first use as the one instance', () => {
    const placed = routes(graph);
    // `makeShelf().routes()`: only what the class starts every instance with; `other`'s entry is not this instance's.
    expect(placed).toContain('ShelfHome /shelf/home');
    // `getDock()` handing back `dock ??= new DockRegistry()`: the one instance `getDock().add(...)` fills.
    expect(placed).toContain('DockMain /dock/main');
    // `makeBin().routes()`: nothing is added to it, and the row says why.
    const rows = graph.unresolved.filter((row) => row.reason === 'route-entries-unread');
    const notes = rows.flatMap((row) => (row.meta?.['notes'] as string[] | undefined) ?? []);
    expect(notes).toEqual([expect.stringMatching(/^the registry is read on an instance made afresh where it is read \(makeBin\(\)\)/)]);
  });
});
