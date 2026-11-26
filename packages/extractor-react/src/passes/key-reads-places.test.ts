import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'key-reads-places-webpack-plugins');

/** Each address placed, as `screen route`, one per route a screen is placed at (a screen's routes are written space-separated). */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .flatMap((node) => {
      const placed = node.meta?.['route'];
      return typeof placed === 'string' ? placed.split(' ').map((route) => `${node.id.split(':').pop()} ${route}`) : [];
    })
    .sort();

describe('routes and links over keys, patterns nested deeper, places of lists put together, objects an adding function writes per call (P351)', () => {
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

  it('reads a route written straight over Object.keys, the element looked up by its key', () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Home /home', 'About /about', 'Importer /tools/import']));
  });

  it('reads a link written straight over Object.keys', () => {
    const links = graph.edges.filter((edge) => edge.meta?.['link'] === 'Link').map((edge) => `${edge.to.split(':').pop()} ${String(edge.meta?.['navigates'])}`);
    expect(links.sort()).toEqual(['About /about', 'Home /home']);
  });

  it('reads a route-level pattern nested deeper than one key of the entry or the item', () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Pricing /areas/pricing', 'Billing /sections/billing', 'Team /team']));
  });

  it('keeps the items of a list put together from lists whose order is known under their places', () => {
    expect(routes(graph)).toEqual(
      expect.arrayContaining([
        'Welcome /wizard/0',
        'Profile /wizard/1',
        'Finish /wizard/2',
        'Welcome /stages/0',
        'Profile /stages/1',
        'Review /stages/2',
        'Welcome /flow/0',
        'Finish /flow/1',
        'Search /tour/0',
        'Support /tour/1',
        'Welcome /late/0',
      ]),
    );
    const late = graph.unresolved.find((row) => row.reason === 'route-entries-unread' && JSON.stringify(row).includes('LATE'));
    expect(JSON.stringify(late)).toContain('are not known');
  });

  it('binds an object an adding function writes from its parameters to each call, under the key the call hands', () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Shoes /catalog/shoes', 'Hats /catalog/hats', 'Scarves /shelves/scarves']));
    expect(routes(graph).some((each) => each.includes('/catalog/name'))).toBe(false);
  });

  it('says the one list whose places are not all known, and nothing else', () => {
    const rows = graph.unresolved.filter((row) => row.reason !== 'type-unresolved');
    expect(rows.map((row) => `${row.reason} ${row.symbol}`)).toEqual(['route-entries-unread routes over Object.entries(LATE)']);
  });
});
