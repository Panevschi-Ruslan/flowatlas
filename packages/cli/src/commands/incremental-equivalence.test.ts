import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSession, type ServiceSession } from '../build/session.js';
import { buildProject } from './build.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');
const FIXTURE = join(FIXTURES, 'nest-incremental');
const FIXED = '2026-01-01T00:00:00.000Z';

/** One change to one file, as `edits/*.json` describes it. */
interface Change {
  file: string;
  replace?: string;
  with?: string;
  append?: string;
  create?: string;
  delete?: boolean;
}

interface Edit {
  name: string;
  expect: { mode: string; files?: string[]; reason?: string };
  changes: Change[];
}

// Beside the fixtures, because a fixture repository resolves `@nestjs/common`
// from the `node_modules` hoisted there and a copy anywhere else has no checker.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-equiv-'));
const repoDir = join(scratch, 'orders');
const configPath = join(scratch, 'flowatlas.config.json');

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const apply = (change: Change): void => {
  const path = join(repoDir, change.file);
  if (change.delete === true) {
    rmSync(path);
    return;
  }
  if (change.create !== undefined) {
    writeFileSync(path, change.create);
    return;
  }
  const text = readFileSync(path, 'utf8');
  if (change.append !== undefined) {
    writeFileSync(path, `${text}${change.append}`);
    return;
  }
  const { replace, with: replacement } = change;
  if (replace === undefined || replacement === undefined) throw new Error('nothing to change');
  if (!text.includes(replace)) throw new Error(`${change.file} no longer contains ${replace}`);
  writeFileSync(path, text.replace(replace, replacement));
};

const edits = (): Array<[string, Edit]> =>
  readdirSync(join(FIXTURE, 'edits'))
    .sort()
    .map((name) => [
      name,
      JSON.parse(readFileSync(join(FIXTURE, 'edits', name), 'utf8')) as Edit,
    ]);

describe('an incremental rebuild and a full one from the same sources', () => {
  let sessions: Map<string, ServiceSession>;

  beforeAll(async () => {
    mkdirSync(repoDir, { recursive: true });
    cpSync(FIXTURE, repoDir, { recursive: true });
    rmSync(join(repoDir, '.flowatlas'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(join(repoDir, 'edits'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(join(repoDir, 'expected.graph.json'), { force: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        { services: [{ name: 'orders', repo: './orders', type: 'nestjs' }], output: '.flowatlas' },
        null,
        2,
      ),
    );

    // A watch opens every repository once and then keeps it, which is the path
    // an incremental rebuild takes and the one worth comparing.
    const loaded = loadConfig(configPath);
    sessions = new Map();
    for (const service of loaded.config.services) {
      const session = openSession({
        service,
        repoDir: loaded.repoDir(service),
        config: loaded.config,
      });
      if (session !== undefined) sessions.set(service.name, session);
    }
    await buildProject({ config: configPath, builtAt: FIXED, cache: false });
  }, 120_000);

  it('agree after every change the fixture scripts', async () => {
    for (const [name, edit] of edits()) {
      for (const change of edit.changes) apply(change);

      const incremental = await buildProject({ config: configPath, builtAt: FIXED, sessions });
      const plan = incremental.plan['orders'];
      expect(plan?.mode, `${name}: ${edit.name}`).toBe(edit.expect.mode);
      if (edit.expect.files !== undefined) expect(plan?.files, name).toEqual(edit.expect.files);
      if (edit.expect.reason !== undefined) expect(plan?.reason, name).toBe(edit.expect.reason);

      const full = await buildProject({ config: configPath, builtAt: FIXED, cache: false });
      expect(JSON.stringify(incremental.project), `${name}: ${edit.name}`).toBe(
        JSON.stringify(full.project),
      );
    }
  }, 300_000);

  it('leaves a cache that says the next build has nothing to do', async () => {
    const again = await buildProject({ config: configPath, builtAt: FIXED, sessions });
    expect(again.plan['orders']).toEqual({ mode: 'skip', reason: '0 files changed' });
    expect(again.timing.files).toEqual([]);
  }, 120_000);
});
