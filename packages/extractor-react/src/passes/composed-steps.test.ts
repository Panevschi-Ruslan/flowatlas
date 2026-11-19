import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'composed-steps-props-factories');

const read = (name: string, type: string): Promise<RepoGraph> =>
  extractRepo({
    rootDir: join(FIXTURE, name),
    repo: name,
    service: { name, repo: join(FIXTURE, name), type },
    registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
    generatedAt: '2026-11-17T00:00:00.000Z',
  });

/** Each navigation edge, as `from -> to (navigates) [query] confidence`. */
const navigations = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.meta?.['navigates'] !== undefined)
    .map((edge) => {
      const query = edge.meta?.['query'];
      return `${edge.from.split('#')[1]} -> ${edge.to.split('#')[1]} (${String(edge.meta?.['navigates'])})${typeof query === 'string' ? ` query ${query}` : ''} ${edge.confidence}`;
    })
    .sort();

/** Each screen placed at an address, as `screen route`. */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => typeof node.meta?.['route'] === 'string')
    .map((node) => `${node.id.split(':').pop()} ${String(node.meta?.['route'])}`)
    .sort();

/** Each site of a reason's rows, folded or not, as `file symbol`, with the row's meta. */
const sites = (graph: RepoGraph, reason: string): Array<{ readonly at: string; readonly meta: Record<string, unknown> }> =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .flatMap((row) => {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const causes = meta['causes'] as Array<{ readonly samples: Array<{ readonly file: string; readonly symbol: string }> }> | undefined;
      return causes === undefined ? [{ at: `${row.file} ${row.symbol ?? ''}`, meta }] : causes.flatMap((cause) => cause.samples.map((sample) => ({ at: `${sample.file} ${sample.symbol}`, meta })));
    })
    .sort((a, b) => a.at.localeCompare(b.at));

describe('steps over a mapped view, an object a reduce gathers, receivers through props and factories, and a query glued to a wrapper segment (P333)', () => {
  let consoleGraph: RepoGraph;
  let site: RepoGraph;
  beforeAll(async () => {
    [consoleGraph, site] = await Promise.all([read('console', 'react'), read('site', 'nextjs')]);
  }, 120000);

  it('reads a step over a view mapped already, and an object a reduce gathers through Object.values or Object.entries', () => {
    expect(routes(consoleGraph)).toEqual(
      expect.arrayContaining([
        // `map(...).flatMap(...)` in a caller's view.
        'Billing /areas/billing',
        'AreaEdit /areas/billing/edit',
        // `map(...).map(...)`.
        'Kanban /boards/kanban/view',
        // `Object.values(reduce(..., {}))`, each team written under a key.
        'Members /teams/members',
        // `Object.entries(reduce(..., {})).map(([, task]) => ...)`.
        'Backlog /tasks/backlog/board',
        // `Object.values(GUIDES)`, an object written in place.
        'Start /guides/start',
        // A registry's reader handing back `this.items.map(...).flatMap(...)`.
        'Atlas /shelves/atlas',
        'AtlasPrint /shelves/atlas/print',
        // A reader handing back `Object.values(this.items.reduce(..., {}))`.
        'FrontDesk /desks/front',
      ]),
    );
  });

  it('follows a receiver through a destructured parameter, component props and a factory, per instance', () => {
    const placed = routes(consoleGraph);
    // `<PanelRoutes registry={panels} />`, added through `installPanel({ registry: panels }, ...)`.
    expect(placed).toContain('Usage /panels/usage');
    // `const menu = makeMenu()`, the object it hands back keeping a variable of its own.
    expect(placed).toContain('MenuHome /menu/home');
    // `drafts`, `archive` and `spare`: other instances, which no route reads.
    expect(placed.some((each) => each.startsWith('Hidden '))).toBe(false);
  });

  it('counts pairs read without being taken apart in route-entries-unread, with why', () => {
    const found = sites(consoleGraph, 'route-entries-unread');
    expect(found.map((row) => row.at)).toEqual(['src/App.tsx routes over logs']);
    expect(String((found[0]?.meta['why'] as string[])[0])).toMatch(/\[key, entry\] pair/);
  });

  it('reads a value glued to a wrapper segment as a query where a use says so, as a guess beside the row where none is read, and never after a /', () => {
    expect(navigations(site)).toEqual([
      // `<FindLink terms="?q=shoes">` and `terms={search.get('again')}`: both at the finder, firmly.
      'src/components/Footer.tsx:Footer -> src/app/find/page.tsx:FindPage (/find?q=shoes) static',
      // `<SearchLink query={search.get('last')}>`, no use read: the search page as a guess.
      "src/components/Recent.tsx:Recent -> src/app/search/page.tsx:SearchPage (/search${search.get('last')}) query guess heuristic",
    ]);
    // The search's row stays beside the guess; the portal's, after a `/`, has no navigation though a page is at /portal.
    expect(sites(site, 'navigation-unresolved').map((row) => row.at)).toEqual([
      "src/components/Footer.tsx Footer navigates to /portal/${search.get('to')}",
      "src/components/Recent.tsx Recent navigates to /search${search.get('last')}",
    ]);
  });
});
