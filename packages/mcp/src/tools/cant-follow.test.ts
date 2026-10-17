import { appendFileSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { saveAccepted } from '@flowatlas/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openGraphDb } from '@flowatlas/linker';
import { createFlowatlasServer } from '../server.js';
import { cantFollowFor } from './cant-follow.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'cant-follow', 'flowatlas.config.json');

let client: Client;

const call = async (args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name: 'cant_follow', arguments: args })) as {
    content: Array<{ text: string }>;
  };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('cant_follow', () => {
  it('leads with the packages nobody installed, and counts every place once', async () => {
    const answer = await call();
    expect(answer.causes[0].cause).toBe('module-not-installed');
    expect(answer.causes[0].packages.map((pkg: { package: string }) => pkg.package)).toEqual([
      '@shopkit/mailer',
      '@shopkit/ledger',
      '@shopkit/queue',
    ]);
    const summed = answer.causes.reduce((sum: number, cause: { sites: number }) => sum + cause.sites, 0);
    expect(summed).toBe(answer.total.sites);
    expect(answer.causes.map((cause: { cause: string }) => cause.cause)).toEqual(
      expect.arrayContaining([
        'import-unresolved',
        're-export-missing',
        'callback-param',
        'dynamic-member',
        'any-typed',
        'untyped-parameter',
        'interface-type',
      ]),
    );
  });

  it('names the method a place is written in, so get_source can open it', async () => {
    const answer = await call({ cause: 'dynamic-member' });
    const [place] = answer.causes[0].packages[0].samples;
    expect(place).toMatchObject({ service: 'storefront', loc: 'src/orders/orders.service.ts:19' });
    expect(place.id).toBe('storefront#src/orders/orders.service.ts:OrdersService.place');
    expect(answer.next[0]).toBe(`get_source({symbol: ${JSON.stringify(place.id)}})`);
  });

  it('narrows to one package, and to one service', async () => {
    const ledger = await call({ package: '@shopkit/ledger' });
    expect(ledger.total.sites).toBe(4);
    expect(ledger.causes.every((cause: { services: string[] }) => cause.services.join() === 'payments')).toBe(true);
    const elsewhere = await call({ service: 'storefront', package: '@shopkit/ledger' });
    expect(elsewhere.total).toEqual({ rows: 0, sites: 0 });
  });
});

describe('cant_follow on a project read without an install (P78)', () => {
  const STANDINS = join(ROOT, 'fixtures', 'uninstalled-internal-packages');
  let standIns: Client;

  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowatlasServer({ configPath: join(STANDINS, 'flowatlas.config.json') }).connect(serverSide);
    standIns = new Client({ name: 'test', version: '0' });
    await standIns.connect(clientSide);
  });

  afterAll(async () => {
    await standIns.close();
  });

  it('names shapes --suggest for a package nothing stands in for', async () => {
    const response = (await standIns.callTool({ name: 'cant_follow', arguments: { cause: 'module-not-installed' } })) as {
      content: Array<{ text: string }>;
    };
    const answer = JSON.parse(response.content[0]!.text);
    const [pkg] = answer.causes[0].packages;
    expect(pkg.package).toBe('@acme/feature-flags');
    expect(pkg.coveredBy).toBeUndefined();
    expect(answer.next).toContain('run: flowatlas shapes --suggest --package "@acme/feature-flags"');
  });

  it('marks the places of a package the configuration now covers', () => {
    const db = openGraphDb(join(STANDINS, '.flowatlas', 'graph.db'), { readonly: true });
    try {
      const answer = cantFollowFor(
        db,
        db.allUnresolved(),
        { cause: 'module-not-installed', top: 10, samples: 3 },
        new Map([['@acme/feature-flags', { by: 'shape' as const, from: 'flowatlas-shapes/flags.d.ts' }]]),
      );
      const [pkg] = answer.causes[0]!.packages;
      expect(pkg).toMatchObject({ coveredBy: 'shape', coveredFrom: 'flowatlas-shapes/flags.d.ts' });
      expect(pkg!.samples.every((sample) => sample.coveredBy === 'shape')).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('cant_follow and accepted.json (P80)', () => {
  let ruled: Client;
  let dbPath: string;

  beforeAll(async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-accepted-'));
    cpSync(join(ROOT, 'fixtures', 'nest-route-access', '.flowatlas'), directory, { recursive: true });
    dbPath = join(directory, 'graph.db');
    saveAccepted(dbPath, [
      { reason: 'route-unguarded', service: 'inventory', path: 'GET /levels/*', note: 'published', acceptedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowatlasServer({ dbPath }).connect(serverSide);
    ruled = new Client({ name: 'test', version: '0' });
    await ruled.connect(clientSide);
  });

  afterAll(async () => {
    await ruled.close();
  });

  const ask = async (args: Record<string, unknown> = {}): Promise<any> => {
    const response = (await ruled.callTool({ name: 'cant_follow', arguments: args })) as { content: Array<{ text: string }> };
    return JSON.parse(response.content[0]!.text);
  };

  it('lets a route rule take the rows it takes in doctor', async () => {
    const answer = await ask();
    expect(answer.accepted).toEqual({ rows: 2, sites: 2 });
    expect(answer.note).toBeUndefined();
  });

  it('says a file it cannot read, and leaves nothing out', async () => {
    const before = await ask();
    appendFileSync(join(dbPath, '..', 'accepted.json'), '}');
    const answer = await ask();
    expect(answer.accepted).toBeUndefined();
    expect(answer.note).toMatch(/^accepted\.json at .* cannot be read \(.*\), so nothing in it is accepted\.$/);
    // The rows the rule took are findings (P81): in none of the gap counts, and
    // back among the findings once nothing is accepted.
    expect(answer.total.sites).toBe(before.total.sites);
    expect(answer.apart.findings).toBe((before.apart?.findings ?? 0) + before.accepted.rows);
  });
});

