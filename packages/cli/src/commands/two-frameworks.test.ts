import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  AdapterRegistry,
  parseConfig,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type RepoGraph,
  type Unresolved,
} from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import type { LinkReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';

/**
 * One repository, two frameworks, and neither of them told about the other.
 *
 * Asserted against the graph rather than against a snapshot: R15 was a whole
 * layer of a service missing, and a snapshot of a graph without it would have
 * passed every gate exactly as happily as one with it (R09).
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'hono-worker');
const API = join(FIXTURE, 'api');
const FIXED = '2026-01-01T00:00:00.000Z';

// Beside the fixtures, so the copy still resolves the packages hoisted there.
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-two-frameworks-'));

let project: ProjectGraph;
let report: LinkReport;

/** Reading `api` with the worker adapter left out, and with it. */
const readApi = async (forceEntry?: string[]): Promise<RepoGraph> => {
  const config = parseConfig({
    services: [{ name: 'api', repo: '.', type: 'nestjs' }],
    ...(forceEntry === undefined ? {} : { adapters: { force: { entry: forceEntry } } }),
  });
  return extractRepo({
    rootDir: API,
    repo: 'api',
    service: config.services[0],
    config,
    registry: registerEntryAdapters(new AdapterRegistry()),
    noTypes: true,
    generatedAt: FIXED,
  });
};

beforeAll(async () => {
  const dir = join(scratch, 'hono-worker');
  cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  const built = await buildProject({ config: join(dir, 'flowatlas.config.json'), builtAt: FIXED });
  project = built.project;
  report = built.report;
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const entries = (): string[] =>
  project.nodes
    .filter((node) => node.type === 'entry' && node.repo === 'api')
    .map((node) => node.id)
    .sort();

const edge = (from: string, type: string, to: string): boolean =>
  project.edges.some((row) => row.from === from && row.type === type && row.to === to);

const goesTo = (from: string, type: string): string[] =>
  project.edges.filter((row) => row.from === from && row.type === type).map((row) => row.to);

describe('a repository that serves routes from two frameworks', () => {
  it('reads both, with one reader and one configured type', () => {
    expect(project.services.find((service) => service.name === 'api')?.extractor).toBe(
      '@flowatlas/extractor-nestjs',
    );
    // The worker's, declared in src/worker.ts and src/admin/admin.routes.ts.
    expect(entries()).toEqual([
      'entry:api:http:ALL:/api/*',
      'entry:api:http:DELETE:/api/depots/:param/cache',
      'entry:api:http:GET:/api/admin/events',
      'entry:api:http:GET:/api/admin/orders/:param',
      'entry:api:http:GET:/api/depots/:param/orders',
      'entry:api:http:GET:/api/depots/:param/stock-stream',
      'entry:api:http:GET:/api/depots/:param/stream',
      'entry:api:http:GET:/health',
      'entry:api:http:POST:/api/admin/notes',
      'entry:api:http:POST:/api/depots/:param/orders/:param/cancel',
      'entry:api:http:POST:/api/messenger/webhook',
      'entry:api:http:POST:/internal/reload',
      'entry:api:http:PUT:/api/admin/notes/:param',
    ]);
  });

  it('reads what a worker route takes from the validator in front of it, and a type argument as a claim (P29)', () => {
    const handles = (id: string) => project.edges.find((edge) => edge.from === id && edge.type === 'handles');
    expect(handles('entry:api:http:POST:/api/admin/notes')?.meta).toMatchObject({
      body: '{text:string;pinned:boolean}',
    });
    expect(handles('entry:api:http:PUT:/api/admin/notes/:param')?.meta).toMatchObject({
      body: 'type:api#NoteChange',
      claimed: ['body'],
    });
  });

  it('draws the application guard on its own routes and on none of the worker routes', () => {
    const guarded = (id: string): string[] => goesTo(id, 'guarded_by');
    expect(guarded('entry:api:http:GET:/api/depots/:param/orders')).toEqual([
      'api#src/auth/api-key.guard.ts:ApiKeyGuard',
    ]);
    // The application's guard never runs for a route the worker answers, so it
    // is not drawn on one. What the worker route does have in front of it is its
    // own middleware, and that is the only thing there.
    for (const id of ['entry:api:http:GET:/health', 'entry:api:http:GET:/api/depots/:param/stream']) {
      expect(guarded(id)).toEqual(['api#src/worker.ts:requestLogger']);
    }
  });

  /**
   * One shape for "this runs in front of that", whichever reader found it.
   *
   * A guard the framework's decorator declares and a middleware chain a call
   * installs are the same fact about a route, and until R109 only the first was
   * an edge: the second was a list on the entry, which every consumer that read
   * the graph as a graph — this project's own audit included — saw as a route
   * with nothing in front of it. The two are compared here, in the one fixture
   * that has both, because a single reader passing its own tests is exactly how
   * that went unnoticed.
   */
  it('spells a decorated guard and an installed middleware chain the same way', () => {
    const wrapping = (id: string): Array<Record<string, unknown>> =>
      project.edges
        .filter((row) => row.from === id && row.type === 'guarded_by')
        .map((row) => ({
          to: project.nodes.find((node) => node.id === row.to)?.type,
          order: row.meta?.['order'],
          layer: row.meta?.['layer'],
          confidence: row.confidence,
        }));
    expect(wrapping('entry:api:http:GET:/api/depots/:param/orders')).toEqual([
      { to: 'guard', order: 0, layer: 'guard', confidence: 'static' },
    ]);
    expect(wrapping('entry:api:http:GET:/health')).toEqual([
      { to: 'middleware', order: 0, layer: 'middleware', confidence: 'static' },
    ]);
  });

  it('carries a route declared in the worker through to the service it reaches', () => {
    const stream = 'entry:api:http:GET:/api/depots/:param/stream';
    const handler = 'api#src/stream/sse.ts:orderStream';
    expect(edge(stream, 'handles', handler)).toBe(true);
    expect(edge(handler, 'calls', 'api#src/orders/orders.service.ts:OrdersService.changesFor')).toBe(
      true,
    );
  });

  it('joins the browser stream to the route in the worker that answers it', () => {
    // R15's own symptom: the address is `/depots/:id/stream`, the route is
    // `/api/depots/:id/stream`, and before this the service was reported as
    // having no such route.
    const call = project.nodes.find(
      (node) => node.type === 'ui_api_call' && node.file?.endsWith('live-events.service.ts'),
    ) as GraphNode;
    expect(goesTo(call.id, 'hits')).toEqual(['entry:api:http:GET:/api/depots/:param/stream']);
    expect(report.ui).toMatchObject({ total: 2, resolved: 2, unresolved: 0 });
  });

  it('does not let the bridge under /api answer for a route that spells itself out', () => {
    const call = project.nodes.find(
      (node) => node.type === 'ui_api_call' && node.file?.endsWith('orders-api.service.ts'),
    ) as GraphNode;
    expect(goesTo(call.id, 'hits')).toEqual(['entry:api:http:GET:/api/depots/:param/orders']);
    const hit = project.edges.find(
      (row: GraphEdge) => row.from === call.id && row.type === 'hits',
    ) as GraphEdge;
    expect(hit.meta?.['note']).toBeUndefined();
  });

  it('places a mounted application where it is served, not where it is declared', () => {
    expect(edge('entry:api:http:GET:/api/admin/events', 'handles', 'api#src/stream/sse.ts:adminEvents')).toBe(
      true,
    );
  });

  it('refuses a route whose address depends on a caller, and says which', () => {
    const files = (reason: string): string[] =>
      project.unresolved
        .filter((row: Unresolved) => row.reason === reason)
        .map((row) => row.file)
        .sort();
    // Two facts, two reasons: the worker's own path is computed, and the
    // reports application's route was read under a mount whose path was not.
    expect(files('route-path-dynamic')).toEqual(['src/worker.ts']);
    expect(files('route-mount-unread')).toEqual(['src/admin/reports.routes.ts']);
  });

  it('points each route answered by a function written in place at that function', () => {
    expect(project.unresolved.filter((row: Unresolved) => row.reason === 'route-handler-anonymous')).toEqual([]);
    const inline = project.nodes.filter(
      (node) => node.type === 'entry' && node.repo === 'api' && node.meta?.['handlerVia'] === 'inline',
    );
    expect(inline.length).toBe(6);
    for (const entry of inline) expect(goesTo(entry.id, 'handles')).toHaveLength(1);
  });
});

describe('the half that was already read', () => {
  let before: RepoGraph;
  let after: RepoGraph;

  beforeAll(async () => {
    before = await readApi(['nestjs-http']);
    after = await readApi();
  }, 120_000);

  /**
   * Everything the repository read as before the worker adapter existed is still
   * there, unchanged, id for id and field for field. A second framework in a
   * repository may add to what is read and may not alter it.
   *
   * The repository's own node is the exception, and has to be: it records which
   * adapters ran and how much was walked, which is a description of the run
   * rather than of the code, and both of those really did change.
   */
  it('is untouched, node for node', () => {
    const found = new Map(after.nodes.map((node: GraphNode) => [node.id, node]));
    const read = before.nodes.filter((node: GraphNode) => node.type !== 'repo');
    for (const node of read) expect(found.get(node.id)).toEqual(node);
    expect(read.length).toBeGreaterThan(0);
  });

  it('says which adapters read it, on the repository and nowhere else', () => {
    const repo = (graph: RepoGraph): unknown =>
      (graph.nodes.find((node: GraphNode) => node.type === 'repo')?.meta?.['adapters'] as {
        entry?: string[];
      })?.entry;
    expect(repo(before)).toEqual(['nestjs-http']);
    expect(repo(after)).toEqual(['nestjs-http', 'hono-routes']);
  });

  it('is untouched, edge for edge', () => {
    const key = (row: GraphEdge): string => `${row.from}\0${row.type}\0${row.to}`;
    const found = new Map(after.edges.map((row: GraphEdge) => [key(row), row]));
    for (const row of before.edges) expect(found.get(key(row))).toEqual(row);
    expect(before.edges.length).toBeGreaterThan(0);
  });

  it('adds the worker and nothing else', () => {
    const known = new Set(before.nodes.map((node: GraphNode) => node.id));
    const added = after.nodes.filter((node: GraphNode) => !known.has(node.id));
    for (const node of added) {
      const fromWorker = node.type === 'entry' && node.meta?.['adapter'] === 'hono-routes';
      // `middleware` is here because what stands in front of a worker route is a
      // node of its own now, which is what makes it visible to a walk (R109).
      expect(fromWorker || node.type === 'function' || node.type === 'middleware').toBe(true);
    }
    expect(added.length).toBeGreaterThan(0);
  });
});
