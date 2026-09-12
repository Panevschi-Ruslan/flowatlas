#!/usr/bin/env node
/**
 * Runs the tool over every fixture, so the snapshot gate has something to
 * compare against.
 *
 *   node scripts/fixtures-run.mjs
 *
 * `fixtures-check.mjs` validates a fixture that has not been run but cannot
 * compare it, and a snapshot nobody compares is not a gate. This produces the
 * output for all of them: `extract` for a single repository, `build` for a
 * project with a configuration.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, 'packages', 'cli', 'bin', 'flowatlas.js');

/**
 * A configuration with nothing in it, for reading one fixture repository.
 *
 * `extract` looks for a configuration upward from where it is run, and would
 * find this repository's own, which points at five repositories on one person's
 * machine and configures a data-layer base class and a broker for them. Nothing
 * depends on that today, which is exactly why it is worth cutting: a fixture
 * that quietly needed somebody's private configuration would read differently
 * for everyone else, and the snapshot would be the last thing to say so.
 */
const NEUTRAL = join(root, 'scripts', 'fixture.config.json');

const run = (args) =>
  execFileSync(process.execPath, [bin, ...args], { cwd: root, stdio: 'pipe' });

let repos = 0;
let projects = 0;
const failures = [];

for (const entry of readdirSync(join(root, 'fixtures'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const dir = join(root, 'fixtures', entry.name);
  const config = join(dir, 'flowatlas.config.json');
  try {
    if (existsSync(config)) {
      run(['build', '--config', config]);
      projects += 1;
    } else if (existsSync(join(dir, 'package.json'))) {
      run(['extract', join('fixtures', entry.name), '--config', NEUTRAL]);
      repos += 1;
    }
  } catch (cause) {
    failures.push(`${entry.name}: ${String(cause.stderr ?? cause.message).trim().slice(0, 300)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`fixtures run: ${repos} repositories, ${projects} projects`);
