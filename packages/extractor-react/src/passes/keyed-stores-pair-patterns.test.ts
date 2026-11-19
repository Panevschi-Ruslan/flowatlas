import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'keyed-stores-pair-patterns');

/** Each address placed, as `screen route`, one per route a screen is placed at (a screen's routes are written space-separated). */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .flatMap((node) => {
      const placed = node.meta?.['route'];
      return typeof placed === 'string' ? placed.split(' ').map((route) => `${node.id.split(':').pop()} ${route}`) : [];
    })
    .sort();

describe("a registry's keyed store, a pair taken apart by an object pattern, a list read as pairs, and a receiver of more than twelve instances (P344)", () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await extractRepo({
      rootDir: join(FIXTURE, 'console'),
      repo: 'console',
      service: { name: 'console', repo: join(FIXTURE, 'console'), type: 'react' },
      registry: registerFrontendAdapters(registerEntryAdapters(new AdapterRegistry())),
      generatedAt: '2026-11-18T00:00:00.000Z',
    });
  }, 120000);

  it('binds the key each adding call writes an entry under, read back as pairs, a Map\'s entries or keys', () => {
    expect(routes(graph)).toEqual(
      expect.arrayContaining([
        // `this.pages[name] = entry` over `Object.entries(this.pages)`: the literal, the `const`, the key the method writes, the field's own.
        'Billing /book/billing',
        'Settings /book/settings',
        'Home /book/home',
        'Overview /book/overview',
        // `this.panels.set(path, Screen)` over `[...this.panels.entries()]`, the entry a value under its key.
        'Usage /panels/usage',
        // `Object.keys(this.tools).map((name) => ({ ..., Screen: this.tools[name] }))`.
        'Exporter /tools/export',
        // `this.areas[area] = entries`, looked up by `this.areas[area]`: the list written under the area asked for.
        'Users /admin/users',
      ]),
    );
    expect(routes(graph).some((each) => each.startsWith('About '))).toBe(false);
  });

  it("reads a pair's entry taken apart by an object pattern, nested and with a default, and a list's item taken apart", () => {
    expect(routes(graph)).toEqual(
      expect.arrayContaining(['Guide /docs/guide', 'Reference /guides/reference', 'Pricing /areas/pricing', 'Help /links/help']),
    );
    const why = graph.unresolved.flatMap((row) => JSON.stringify(row.meta ?? {}));
    expect(why.some((each) => each.includes('taken apart as [key, entry]'))).toBe(false);
  });

  it("binds a list's places as its keys", () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Welcome /wizard/0', 'Finish /wizard/1']));
  });

  it('reads the first twelve instances a receiver may hold and counts the rest', () => {
    const shelves = routes(graph).filter((each) => each.startsWith('ShelfPage '));
    expect(shelves).toHaveLength(12);
    expect(shelves).not.toContain('ShelfPage /shelves/13');
    // Said in the folded row by the place past its samples, its own `why` among the values none of the samples writes.
    const said = JSON.stringify(graph.unresolved.filter((row) => row.reason === 'route-entries-unread'));
    expect(said).toContain('may hold 13 instances, more than the 12 read: the other 1 is not read');
  });

  it('says what each place past the samples of a folded row writes that none of them does', () => {
    const [folded] = graph.unresolved.filter((row) => row.reason === 'route-entries-unread');
    expect(folded?.sites).toBe(5);
    type Differing = { readonly sites: number; readonly first: { readonly file: string; readonly meta?: Record<string, unknown> } };
    const [part] = folded?.meta?.['causes'] as Array<{ readonly samples: unknown[]; readonly differing?: Differing[] }>;
    expect(part?.samples).toHaveLength(3);
    expect(part?.differing?.map((each) => [each.sites, each.first.file, each.first.meta?.['list']])).toEqual([
      [1, 'src/App.tsx', 'EXTRA_D'],
      [1, 'src/routes/ShelfRoutes.tsx', 'shelf.routes()'],
    ]);
  });
});
