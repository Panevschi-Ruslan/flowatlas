import { join, resolve } from 'node:path';
import { AdapterRegistry, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo } from '../extract-repo.js';

const FIXTURE = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'minified-helpers-module-order-nested-adders');

/** Each address placed, as `screen route`, one per route a screen is placed at (a screen's routes are written space-separated). */
const routes = (graph: RepoGraph): string[] =>
  graph.nodes
    .flatMap((node) => {
      const placed = node.meta?.['route'];
      return typeof placed === 'string' ? placed.split(' ').map((route) => `${node.id.split(':').pop()} ${route}`) : [];
    })
    .sort();

describe('places of a list added to across modules in the order they are evaluated, objects reached through adding functions handing on their parameters (P355)', () => {
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

  it("places a registry's items, read as [place, item] pairs, in the order the modules adding them are evaluated", () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Welcome /steps/0', 'Billing /steps/1', 'Profile /steps/2', 'Intro /steps/3']));
  });

  it("places a module's list pushed onto from other modules in the order they are evaluated", () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Outbox /panels/0', 'Inbox /panels/1', 'Archive /panels/2']));
  });

  it('says why the places are not known where an adding module is reached through a dynamic import, or from two entry points', () => {
    const rows = JSON.stringify(graph.unresolved.filter((row) => row.reason === 'route-entries-unread'));
    expect(rows).toContain('the places of the items of tourRoutes() are not known: tour-late.ts is loaded only by a dynamic import(), at a time not known');
    expect(rows).toContain('the places of the items of widgetRoutes() are not known: the modules adding to it are reached from 2 entry points (admin.tsx, main.tsx)');
    expect(routes(graph).some((each) => each.includes('/tours/') || each.includes('/widgets/'))).toBe(false);
  });

  it('reads an object an adding function writes at the calls of adding functions handing it their own parameters', () => {
    expect(routes(graph)).toEqual(expect.arrayContaining(['Shoes /catalog/shoes', 'Home /catalog/home', 'Hats /catalog/hats', 'Sale /catalog/sale']));
    expect(routes(graph).filter((each) => each.includes('/catalog/'))).toHaveLength(4);
  });
});
