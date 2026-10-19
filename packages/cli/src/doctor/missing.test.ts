import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { MissingGroup } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject } from '../commands/build.js';
import { runMissingCommand } from '../commands/doctor.js';
import { linkSuggested } from '../commands/link.js';
import { candidatesFor, missingEntryOf, sayMissing } from './missing.js';

/**
 * Where the repository probably missing may be on disk (P122): the
 * directories beside the configured ones, by what their manifest, their name
 * and the compose files beside the configuration say, and nothing else.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';

const group = (token: string, key = token): MissingGroup => ({ token, key, score: 1, places: 1, kinds: ['setting'], signals: [] });

const write = (path: string, text: string): void => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-missing-'));
const project = join(scratch, 'shop');
write(join(project, 'flowatlas.config.json'), '{ "services": [{ "name": "gateway", "repo": "./gateway", "type": "nestjs" }] }\n');
write(join(project, 'gateway', 'package.json'), '{ "name": "@acme/gateway" }\n');
// By its manifest, with source the reader could not parse and setting files below its top it must not read.
write(join(project, 'payments-api', 'package.json'), '{ "name": "@acme/payments-api" }\n');
write(join(project, 'payments-api', 'src', 'index.ts'), 'export const = {{{ not a program\n');
write(join(project, 'payments-api', 'src', 'package.json'), '{ "name": "@acme/search" }\n');
write(join(project, 'payments-api', 'src', '.env.example'), 'PORT=9999\n');
// By its name only: no manifest.
write(join(project, 'payment', 'README.md'), 'notes\n');
// By the compose file beside the configuration, and by the port its own example file names.
write(join(project, 'ledger', 'package.json'), '{ "name": "ledger" }\n');
write(join(project, 'ledger', '.env.example'), 'PORT=4100\n');
write(join(project, 'docker-compose.yml'), 'services:\n  accounts:\n    build: ./ledger\n');
// Hidden and built directories are never offered.
write(join(project, '.payments', 'package.json'), '{ "name": "payments" }\n');
write(join(project, 'node_modules', 'payments', 'package.json'), '{ "name": "payments" }\n');

const options = { configured: [join(project, 'gateway')], configDir: project };

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('candidatesFor', () => {
  it('finds a directory by its manifest, by its name, and says which', () => {
    const [found] = candidatesFor([group('payments', 'payment')], options);
    expect(found?.map((candidate) => [candidate.dir.slice(project.length + 1), candidate.name, candidate.matchedBy])).toEqual([
      ['payment', undefined, ['directory']],
      ['payments-api', '@acme/payments-api', ['package', 'directory']],
    ]);
  });

  it('reads nothing of a candidate but its manifest and the files at its top', () => {
    // `src/` holds a manifest and a port of its own, and a file that would not parse: none of it is read.
    expect(candidatesFor([group('search')], options)).toEqual([[]]);
    expect(candidatesFor([group('localhost:9999')], options)).toEqual([[]]);
  });

  it('finds one by a compose service built from it, and by a host its own files name', () => {
    const [byCompose, byPort] = candidatesFor([group('accounts', 'account'), group('localhost:4100')], options);
    expect(byCompose?.map((candidate) => candidate.matchedBy)).toEqual([['compose']]);
    expect(byPort?.map((candidate) => candidate.matchedBy)).toEqual([['hosts']]);
  });

  it('never offers a configured repository, and looks in --scan directories too', () => {
    expect(candidatesFor([group('gateway')], options)).toEqual([[]]);
    const elsewhere = join(scratch, 'elsewhere');
    write(join(elsewhere, 'search-service', 'package.json'), '{ "name": "search-service" }\n');
    const [found] = candidatesFor([group('search')], { ...options, scan: [elsewhere] });
    expect(found?.map((candidate) => candidate.matchedBy)).toEqual([['package', 'directory']]);
  });

  it('lists two that fit, and says to link the one it is', () => {
    const [found] = candidatesFor([group('payments', 'payment')], options);
    const lines = sayMissing(missingEntryOf(group('payments', 'payment'), found ?? [], project), { configDir: project, cwd: project, configPath: join(project, 'flowatlas.config.json') });
    expect(lines).toEqual([
      'Probably missing: a repository for "payments" — 1 kind of evidence, 1 place',
      '  2 directories look like it; link the one it is:',
      '    ./payment (no package.json; by its name only): flowatlas link ./payment',
      '    ./payments-api (package @acme/payments-api, its directory name): flowatlas link ./payments-api',
    ]);
  });

  it('says so when nothing fits', () => {
    const lines = sayMissing(missingEntryOf(group('inventory'), [], project));
    expect(lines.at(-1)).toBe('  nothing next to the configured repositories looks like it; if it exists elsewhere, `flowatlas link <path>`');
  });

  it('says each place of traffic with what it reached and the window it was seen in (P144)', () => {
    const seen = { kind: 'http', places: 6, count: 9, names: ['POST /charges', 'POST /refunds'], window: '2h' };
    const traffic: MissingGroup = {
      ...group('payments', 'payment'),
      kinds: ['traffic'],
      signals: [{ kind: 'traffic', name: 'payments', token: 'payments', places: [{ service: 'payments', gapId: 'gap:payments||seen-not-in-code', seen }] }],
    };
    const entry = missingEntryOf(traffic, [], project);
    expect(entry.weak).toBe(true);
    expect(entry.signals[0]?.places[0]?.seen).toEqual(seen);
    expect(sayMissing(entry, { everyPlace: true, placeSaid: (place) => place.service ?? '' }).slice(1, 3)).toEqual([
      '  traffic came from payments, which no configured service is: 6 routes, 9 spans in 2h',
      '    payments: 6 routes, 9 spans in 2h: POST /charges, POST /refunds, and 4 more',
    ]);
  });
});

describe('flowatlas link --suggested (P122)', () => {
  // Beside the fixtures, so the copy still resolves the packages hoisted there.
  const copies = mkdtempSync(join(ROOT, 'fixtures', '.scratch-missing-repo-'));
  const dir = join(copies, 'missing-repo');
  const config = join(dir, 'flowatlas.config.json');
  cpSync(join(ROOT, 'fixtures', 'missing-repo'), dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas') && !from.split(sep).includes('variants'),
  });
  afterAll(() => rmSync(copies, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const quiet = { out() {}, err() {} };

  it('links the one directory that fits, and after a rebuild the request and the channel join and the group is gone', async () => {
    await buildProject({ config, builtAt: FIXED, cache: false });
    const before = runMissingCommand({ config }, quiet).missing;
    expect(before.map((entry) => [entry.token, entry.kinds, entry.candidates.map((candidate) => candidate.path)])).toEqual([
      ['payments', ['setting', 'package', 'channel', 'subscription'], ['./payments-api']],
    ]);

    const said: string[] = [];
    const dry = linkSuggested({ config, dryRun: true, print: (line) => said.push(line) });
    expect(dry.chosen).toEqual([join(dir, 'payments-api')]);
    expect(JSON.parse(readFileSync(config, 'utf8')).services).toHaveLength(3);

    linkSuggested({ config, mcp: false, print: () => {} });
    expect(JSON.parse(readFileSync(config, 'utf8')).services.map((service: { name: string }) => service.name)).toEqual([
      'gateway',
      'jobs',
      'orders',
      'payments-api',
    ]);
    const after = await buildProject({ config, builtAt: FIXED, cache: false });
    expect(after.report.httpOut.linked).toBe(2);
    expect(after.report.channels.linked).toBe(1);
    expect(runMissingCommand({ config }, quiet).missing).toEqual([]);
  }, 180_000);
});
