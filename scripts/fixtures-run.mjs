#!/usr/bin/env node
/**
 * Runs the tool over every fixture, so the snapshot gate has something to
 * compare against.
 *
 *   node scripts/fixtures-run.mjs
 *
 * `fixtures-check.mjs` validates a fixture that has not been run but cannot
 * compare it, and a snapshot nobody compares is not a gate. This produces the
 * output for all of them: `extract` for a single repository, `build` and then
 * `contracts` for a project with a configuration.
 *
 * Which of the two a fixture is, and the steps for it, are `fixture-layout.mjs` -
 * shared with the checker, so that the two cannot disagree about whether a
 * fixture was run.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CANNOT_RUN, fixtureDirs, layoutOf, outputDir, root } from './fixture-layout.mjs';

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

const done = { repo: 0, project: 0, none: 0 };
let declined = 0;
const failures = [];

for (const dir of fixtureDirs()) {
  const { kind, steps } = layoutOf(dir);
  done[kind] += 1;
  for (const { args, writes, mayDecline = false } of steps) {
    // Last run's answer is not this run's: see `steps` in fixture-layout.mjs.
    for (const file of writes) rmSync(join(outputDir(dir), file), { force: true });
    try {
      run(args(dir, { neutral: NEUTRAL }));
    } catch (cause) {
      if (mayDecline && cause.status === CANNOT_RUN) {
        declined += 1;
        continue;
      }
      failures.push(`${basename(dir)}: ${String(cause.stderr ?? cause.message).trim().slice(0, 300)}`);
      break;
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(
  `fixtures run: ${done.repo} repositories, ${done.project} projects` +
    (declined > 0 ? ` (${declined} step(s) declined: nothing to compare)` : ''),
);
