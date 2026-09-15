import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configResultSchema,
  cyclesResultSchema,
  deadResultSchema,
  hotspotsResultSchema,
} from '../analysis/shapes.js';
import { buildProject } from './build.js';
import { runConfig, SelectorError } from './config.js';
import { runCycles } from './cycles.js';
import { runDead } from './dead.js';
import { runHotspots } from './hotspots.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo-analytics');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-analytics-'));
let db = '';

/** What the four commands are expected to answer, recorded beside the fixture. */
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE, `expected.${name}.json`), 'utf8'));

beforeAll(async () => {
  // Built into a directory of its own so the read-only assertion below has
  // something whose timestamps nothing else can touch.
  const result = await buildProject({ config: CONFIG, out: scratch, builtAt: '2026-01-01T00:00:00.000Z' });
  db = result.dbPath;
}, 180_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('cycles on the analytics fixture', () => {
  it('finds the two loops no repository can see on its own', () => {
    const { result } = runCycles({ db, crossService: true });
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles.map((cycle) => cycle.services)).toEqual([
      ['billing', 'orders'],
      ['gateway', 'orders'],
    ]);
    expect(result.cycles.every((cycle) => cycle.confidence === 'static')).toBe(true);
  });

  it('reads the message loop as publisher straight to handler, naming the channel', () => {
    const { result } = runCycles({ db, crossService: true });
    const messages = result.cycles[0]!;
    const collapsed = messages.edges.filter((hop) => hop.via !== undefined);
    expect(collapsed.map((hop) => hop.via)).toEqual([
      'channel:invoice.changed',
      'channel:order.changed',
    ]);
    expect(messages.nodes.some((id) => id.startsWith('channel:'))).toBe(false);
  });

  it('adds the recursion inside one service once the flag is dropped', () => {
    const { result } = runCycles({ db });
    expect(result.cycles).toHaveLength(3);
    expect(result.cycles[2]!.services).toEqual(['orders']);
  });

  it('shows the forwardRef pair only when asked for dependency edges', () => {
    const without = runCycles({ db }).result.cycles;
    const withDi = runCycles({ db, includeDi: true }).result.cycles;
    expect(withDi).toHaveLength(without.length + 1);
    expect(withDi.at(-1)!.nodes.join(' ')).toContain('DiscountService');
  });

  it('answers what was recorded', () => {
    expect(runCycles({ db }).result).toEqual(recorded('cycles'));
  });
});

describe('dead on the analytics fixture', () => {
  it('reports the route nobody calls, both one-ended channels and the unused provider', async () => {
    const { result } = await runDead({ db });
    expect(result.entries?.map((row) => row.id)).toEqual([
      'entry:billing:event:orphan.in',
      'entry:gateway:http:GET:/internal/legacy',
      'entry:gateway:http:POST:/orders',
    ]);
    expect(result.channels?.map((row) => row.id)).toEqual(['channel:audit.log', 'channel:orphan.in']);
    expect(result.providers?.map((row) => row.id)).toEqual([
      'orders#src/orders/unused.service.ts:UnusedService',
    ]);
  });

  it('never claims certainty, and every row says what was checked', async () => {
    const { result } = await runDead({ db });
    expect(result.confidence).toBe('heuristic');
    for (const row of [...(result.entries ?? []), ...(result.channels ?? []), ...(result.providers ?? [])]) {
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it('leaves the cron entry out and says which kinds it excluded', async () => {
    const { result } = await runDead({ db });
    expect(result.entries?.map((row) => row.id)).not.toContain('entry:admin:cron:SyncJob.hourly');
    expect(result.excludedEntryKinds).toContain('cron');
  });

  it('says how many injects went unresolved, so a provider row can be doubted', async () => {
    const { result, lines } = await runDead({ db });
    expect(result.unresolvedInjects).toBe(3);
    expect(lines.join('\n')).toContain('could not be resolved');
  });

  it('asks the contract checker about fields, and names the two nobody declares', async () => {
    // It used to answer `contracts-unavailable`, because the checker did not
    // exist, and then nothing, because a body written as an object literal was
    // read as a shape with no fields. Read field by field, two of the bodies
    // sent to `POST /orders/create` carry a field its handler never declares.
    const { result } = await runDead({ db });
    expect(result.fields?.map((row) => row.field)).toEqual(['draft', 'orderId']);
    expect(result.warnings).toBeUndefined();
  });

  it('narrows every section to one service', async () => {
    const { result } = await runDead({ db, service: 'billing' });
    expect(result.entries?.every((row) => row.service === 'billing')).toBe(true);
    expect(result.providers).toEqual([]);
  });

  it('answers what was recorded', async () => {
    expect((await runDead({ db })).result).toEqual(recorded('dead'));
  });
});

describe('config on the analytics fixture', () => {
  it('collects the guard secret and both keys the far service reads', () => {
    const { result } = runConfig('POST /orders', { db });
    expect(result.flow?.entry).toBe('entry:gateway:http:POST:/orders');
    expect(result.services['gateway']?.map((row) => row.key)).toEqual(['JWT_SECRET', 'ORDERS_URL']);
    expect(result.services['orders']?.map((row) => row.key)).toEqual([
      'BILLING_URL',
      'ORDERS_DB_URL',
    ]);
    expect(result.services['web']).toBeUndefined();
  });

  it('lists every key in the project when no flow is named', () => {
    const { result } = runConfig(undefined, { db, all: true });
    expect(Object.keys(result.services)).toEqual(['admin', 'billing', 'gateway', 'orders']);
    expect(result.services['orders']?.map((row) => row.key)).toEqual([
      'BILLING_URL',
      'GATEWAY_URL',
      'ORDERS_DB_URL',
    ]);
  });

  it('resolves a route named the way a person names it, holes and all', () => {
    const { result } = runConfig('GET /accounts/42', { db });
    expect(result.flow?.entry).toBe('entry:gateway:http:GET:/accounts/:param');
  });

  it('fails rather than guessing when nothing matches', () => {
    let caught: unknown;
    try {
      runConfig('POST /nowhere', { db });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SelectorError);
    expect((caught as SelectorError).code).toBe('selector-not-found');
  });

  it('answers what was recorded', () => {
    expect(runConfig('POST /orders', { db }).result).toEqual(recorded('config'));
  });
});

describe('hotspots on the analytics fixture', () => {
  it('puts the route three services call first', () => {
    const { result } = runHotspots({ db, top: 1 });
    expect(result.rows[0]).toMatchObject({
      id: 'entry:orders:http:POST:/orders/create',
      inDegree: 4,
      callerServices: ['admin', 'billing', 'gateway'],
      byEdgeType: { http_calls: 4 },
    });
  });

  it('keeps it first when ranking by how many services reach it', () => {
    const { result } = runHotspots({ db, top: 1, crossService: true });
    expect(result.rows[0]!.id).toBe('entry:orders:http:POST:/orders/create');
  });

  it('narrows to one node type', () => {
    const { result } = runHotspots({ db, top: 5, type: ['provider'] });
    expect(result.rows.every((row) => row.type === 'provider')).toBe(true);
  });

  it('answers what was recorded', () => {
    expect(runHotspots({ db, top: 10 }).result).toEqual(recorded('hotspots'));
  });
});

describe('what every one of them promises', () => {
  it('validates against its own published shape', async () => {
    const dead = await runDead({ db });
    expect(() => cyclesResultSchema.parse(runCycles({ db }).result)).not.toThrow();
    expect(() => deadResultSchema.parse(dead.result)).not.toThrow();
    expect(() => configResultSchema.parse(runConfig('POST /orders', { db }).result)).not.toThrow();
    expect(() => hotspotsResultSchema.parse(runHotspots({ db }).result)).not.toThrow();
  });

  it('cuts the output at --max and says how much it left out', async () => {
    const cycles = runCycles({ db, max: 1 });
    expect(cycles.result.cycles).toHaveLength(1);
    expect(cycles.result.truncated).toBeGreaterThanOrEqual(1);
    expect(cycles.lines.at(-1)).toMatch(/^… \d+ more rows$/);

    const dead = await runDead({ db, max: 1 });
    expect(dead.result.truncated?.['entries']).toBeGreaterThanOrEqual(1);
    expect(dead.lines.join('\n')).toContain('more rows');

    const hotspots = runHotspots({ db, max: 1 });
    expect(hotspots.result.rows).toHaveLength(1);
    expect(hotspots.result.truncated).toBeGreaterThanOrEqual(1);

    const config = runConfig(undefined, { db, all: true, max: 1 });
    expect(config.result.truncated).toBeGreaterThanOrEqual(1);
  });

  it('writes nothing: the graph and its journal come out byte for byte the same', async () => {
    // `graph.db-shm` is left out on purpose. It is SQLite's shared-memory
    // index, and opening a WAL database read-only still stamps it; nothing in
    // it is part of the graph.
    const carried = (): Array<[string, string]> =>
      readdirSync(scratch)
        .filter((name) => !name.endsWith('-shm'))
        .map((name) => [
          name,
          createHash('sha256').update(readFileSync(join(scratch, name))).digest('hex'),
        ]);

    const before = carried();

    runCycles({ db });
    await runDead({ db });
    runConfig('POST /orders', { db });
    runHotspots({ db });

    expect(carried()).toEqual(before);
  });

  it('says to build first rather than crashing when there is no graph', () => {
    expect(() => runCycles({ db: join(scratch, 'nothing.db') })).toThrow(/flowatlas build/);
  });
});
