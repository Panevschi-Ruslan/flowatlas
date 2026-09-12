import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The fixture project the query tests read, and the graph they read from it. */
export const FIXTURE_CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');
const GRAPH = join(ROOT, 'fixtures', 'multi-repo', '.flowatlas', 'graph.db');
const BIN = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');

/**
 * Builds the fixture graph if it is not there.
 *
 * The graph is generated, so it is not committed, so a fresh clone does not have
 * one. Tests that read it used to fail with whatever error a missing database
 * produced three calls later; building it here means `pnpm -r test` works on a
 * checkout nobody has run anything in yet.
 *
 * It is deliberately not rebuilt when it already exists. `pnpm check` rebuilds it
 * before the snapshot gate, which is where staleness would actually matter.
 */
export const ensureFixtureGraph = () => {
  if (existsSync(GRAPH)) return;
  if (!existsSync(join(ROOT, 'packages', 'cli', 'dist', 'index.js'))) {
    throw new Error(
      'the fixture graph is missing and flowatlas is not built, so it cannot be made.\n' +
        'Run `pnpm -r build` first, or `pnpm check`, which does both in order.',
    );
  }
  // `pnpm -r test` runs the packages at once, so two of them can arrive here
  // together and build into the same directories. Making the directory is the
  // one thing the filesystem promises only one of them will win.
  const lock = join(ROOT, 'fixtures', 'multi-repo', '.build-lock');
  try {
    mkdirSync(lock, { recursive: false });
  } catch {
    const idle = new Int32Array(new SharedArrayBuffer(4));
    for (let waited = 0; waited < 120_000 && !existsSync(GRAPH); waited += 100) {
      Atomics.wait(idle, 0, 0, 100);
    }
    if (!existsSync(GRAPH)) throw new Error('waited for another process to build the fixture graph, and it did not');
    return;
  }
  try {
    execFileSync(process.execPath, [BIN, 'build', '--config', FIXTURE_CONFIG], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
};

/** vitest calls the default export once per package, before any test file runs. */
export default ensureFixtureGraph;
