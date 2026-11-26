import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'caller-steps-handed-instances');

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

/** Each row of a reason, as `file symbol`, with its meta. */
const rows = (graph: RepoGraph, reason: string): Array<{ readonly at: string; readonly meta: Record<string, unknown> }> =>
  graph.unresolved
    .filter((row) => row.reason === reason)
    .map((row) => ({ at: `${row.file} ${row.symbol ?? ''}`, meta: (row.meta ?? {}) as Record<string, unknown> }))
    .sort((a, b) => a.at.localeCompare(b.at));

describe('a caller view through flatMap, Array.from or reduce, an instance reached through a parameter, a field or an import, and a wrapper prop of any name (P326)', () => {
  let consoleGraph: RepoGraph;
  let site: RepoGraph;
  beforeAll(async () => {
    [consoleGraph, site] = await Promise.all([read('console', 'react'), read('site', 'nextjs')]);
  }, 120000);

  it('reads a view the caller makes with flatMap, Array.from or reduce, each step writing an object over the item', () => {
    const placed = routes(consoleGraph);
    expect(placed).toEqual(
      expect.arrayContaining([
        // `listAreas().flatMap((area) => ({ ...area, path }))`.
        'Billing /areas/billing',
        // `listReports().flatMap((report) => [{ ... }, { ... }])`: two routes per report.
        'Invoices /reports/invoices',
        'InvoicesEdit /reports/invoices/edit',
        // `Array.from(listBoards(), (board) => ({ ... }))`.
        'Kanban /boards/kanban',
        // `reduce((all, team) => [...all, { ... }], [])`.
        'Members /teams/members',
        // `reduce((all, task) => { all.push({ ... }); return all; }, [])`.
        'Backlog /tasks/backlog',
        // `flatMap((guide) => (guide.path === '' ? [] : [guide]))`: the guide as it is.
        'Guides /guides',
      ]),
    );
  });

  it("follows an instance's field through an import, a parameter it is handed, and another class's field given it when made", () => {
    const placed = routes(consoleGraph).filter((each) => each.includes('/panels/'));
    expect(placed).toEqual(
      [
        // `panels.items.push(...)` in another module, the instance imported.
        'Stats /panels/stats',
        // `installPanel(panels, ...)`: the instance handed through a parameter.
        'Usage /panels/usage',
        // `new PanelBook(panels)`, `this.registry.items.push(...)` off a parameter property.
        'Alerts /panels/alerts',
        // `new PanelShelf(panels)`, the field its constructor writes, through `this.keep(...)`.
        'Limits /panels/limits',
      ].sort(),
    );
    // `installPanel(drafts, ...)` adds to another instance, which no route reads.
    expect(routes(consoleGraph).some((each) => each.startsWith('Hidden '))).toBe(false);
  });

  it("counts a reduce's entries not read, with why, in the route-entries-unread row", () => {
    const found = rows(consoleGraph, 'route-entries-unread');
    expect(found.map((row) => row.at)).toEqual(['src/App.tsx routes over logs']);
    expect(found[0]?.meta).toMatchObject({ unread: 1, read: 0 });
    expect(String((found[0]?.meta['why'] as string[])[0])).toMatch(/reduce/);
  });

  it("reads a wrapper's prop of any name put into its link's address after a written segment, through a const in the wrapper", () => {
    expect(navigations(site)).toEqual([]);
    // Rows alike are folded into one, its sites sampled: each site, wherever it is folded.
    const sites = rows(site, 'navigation-unresolved').flatMap((row) => {
      const causes = row.meta['causes'] as Array<{ readonly samples: Array<{ readonly file: string; readonly symbol: string }> }> | undefined;
      return causes === undefined ? [row.at] : causes.flatMap((cause) => cause.samples.map((sample) => `${sample.file} ${sample.symbol}`));
    });
    expect(sites.sort()).toEqual([
      // `<ConsoleLink target>`, the wrapper building `/console${props.target}` in a const it hands its link.
      "src/components/Back.tsx Back navigates to /console${search.get('back')}",
      // `<AreaLink path>`, the wrapper rendering `<Link href={`/area${path}`}>`.
      "src/components/Return.tsx Return navigates to /area${search.get('next')}",
    ]);
    // The fold says what both say; each place keeps its own prefix in the fold's list (P338).
    const [folded] = rows(site, 'navigation-unresolved');
    expect(folded?.meta).toMatchObject({ why: 'dynamic' });
    expect(folded?.meta).not.toHaveProperty('prefix');
    const prefixes = (folded?.meta['causes'] as Array<{ readonly samples: Array<{ readonly meta?: Record<string, unknown> }> }>).flatMap((cause) => cause.samples.map((sample) => sample.meta?.['prefix']));
    expect(prefixes.sort()).toEqual(['/area', '/console']);
  });
});
