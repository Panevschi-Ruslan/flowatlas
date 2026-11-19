import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'registry-fields-caller-views');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-17T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates) [through wrapper]`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => {
      const wrapper = edge.meta?.['wrapper'];
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])})${typeof wrapper === 'string' ? ` through ${wrapper}` : ''}`;
    })
    .sort();

/** Each screen placed at an address, as `screen route`. */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => typeof node.meta?.['route'] === 'string')
    .map((node) => `${node.id.split(':').pop()} ${String(node.meta?.['route'])}`)
    .sort();

/** Each row of a reason, as `file symbol (why)`. */
const rows = (graph: RepoGraph, reason: string): Array<{ readonly at: string; readonly meta: Record<string, unknown> }> =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .map((row) => ({ at: `${row.file} ${row.symbol ?? ''}`, meta: (row.meta ?? {}) as Record<string, unknown> }))
    .sort((a, b) => a.at.localeCompare(b.at));

describe("a class's field and another module's class reaching a registry, a view the caller makes, a wrapper's prefix, and a route list's entries not read (P320)", () => {
  let consoleGraph: RepoGraph;
  let site: RepoGraph;
  beforeAll(async () => {
    [consoleGraph, site] = await Promise.all([read('console', 'react'), read('site', 'nextjs')]);
  }, 120000);

  it("follows a class's static field and the methods of another module's class wherever the repository names them, and reads the view the caller makes", () => {
    expect(routes(consoleGraph)).toEqual([
      // `pages = listPages().filter(...).map((page) => ({ ...page, path: `/app${page.path}` }))`, then `pages.map(... <Route>)`.
      'Drafts /app/drafts',
      'Home /app/home',
      // `Shelf.entries.set(...)` in another module; `shelfPages()` reads `Shelf.entries` by name.
      'Archive /archive',
      // `WidgetRegistry.items.push(...)` outside the class and outside any function, mapped under `/widgets` by the class's reader.
      'Clock /widgets/clock',
      // `SectionCatalog.register(...)`, a static method of another module's class adding to `sections`.
      'Inbox /inbox',
      // `book.add(...)`, an instance's method, through `this.keep(...)`.
      'Outbox /outbox',
      // `addWidget(...)`, a function of another module pushing onto the class's static field.
      'Weather /widgets/weather',
    ].sort());
  });

  it("says where a route list's entries are not read, with why, rather than only through a navigation landing nowhere", () => {
    const found = rows(consoleGraph, 'route-entries-unread');
    expect(found.map((row) => row.at)).toEqual(['src/App.tsx routes over tools']);
    expect(found[0]?.meta).toMatchObject({ unread: 1, read: 0, why: ['the list is mapped in a way not read: a function of its own maps each entry'] });
    const unread = consoleGraph.unresolved.find((row) => row.reason === 'route-entries-unread');
    expect(unread?.level).toBe('info');
  });

  it("reads a wrapper's prop put after a segment written out whole as an address, its value not read said where it is handed with the prefix", () => {
    // `AppLink` renders `<Link href={`/app${to}`}>`: no navigation of its own.
    expect(navigations(site)).toEqual([]);
    const found = rows(site, 'navigation-unresolved');
    expect(found.map((row) => row.at)).toEqual(["src/components/Resume.tsx Resume navigates to /app${search.get('from')}"]);
    expect(found[0]?.meta).toMatchObject({ why: 'dynamic', prefix: '/app' });
  });
});
