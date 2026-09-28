#!/usr/bin/env node
/**
 * I14 - the coverage harness and the tool agree about what a service is.
 *
 * `scripts/coverage/extent.mjs` works out a service's extent - its own directory
 * plus the workspace packages it declares - from the repository's manifests, and
 * deliberately does not ask `@flowatlas/core`, which can answer the same
 * question. The reason is in that file's header: a denominator computed by the
 * code being measured cannot disagree with it, so a reader that stopped walking a
 * package early would lose sites from the numerator and the same package from the
 * denominator, and coverage would read a hundred per cent while the tool read
 * less than it did yesterday.
 *
 * The price of that independence is two implementations of one question, which
 * drift. This is what is paid instead of drifting silently: the two are run
 * against every fixture in this repository and any disagreement is a failure
 * somebody has to look at. Neither one depends on the other at measurement time,
 * and neither is presumed right here - the gate reports the difference and a
 * person decides which of the two is wrong.
 *
 * It is cheap because the fixtures are small and already on disk: a walk of
 * sixty directories and no build.
 *
 * The fixtures are a thin test of it, and the thinness is worth writing down:
 * between them they declare one level of one dependency section, so a
 * disagreement about a transitive chain or about a section nobody's fixture uses
 * would not show here. Where the coverage clones happen to be on this machine
 * they are checked too, and they are the opposite - one of them reaches
 * seventy-four packages through four sections - which is why this gate says how
 * many real repositories it was able to include. None on a fresh checkout, all
 * eight after a coverage run.
 *
 * Run from the repository root, after a build:
 *
 *   node scripts/check-coverage-extent.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extentOf } from './coverage/extent.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES = join(ROOT, 'fixtures');

if (!existsSync(join(ROOT, 'packages', 'core', 'dist'))) {
  console.error('    FAIL: @flowatlas/core is not built, so there is nothing to agree with.');
  console.error('    Run `pnpm -r build` first; `pnpm check` already does.');
  process.exit(2);
}

const { serviceSourceDirs } = await import('@flowatlas/core');

/**
 * Every directory in the fixture tree that could be pointed at as a service,
 * each with the tree it belongs to.
 *
 * The tree matters: the harness always asks about a directory inside a clone and
 * stops looking for a workspace root at the top of it, because a checkout's
 * parents are the machine's business and not the repository's. One fixture is one
 * such tree. Asking the two implementations about different boundaries would be
 * comparing two questions again, which is the mistake this whole change is
 * about.
 */
const candidates = () => {
  const found = [];
  const visit = (tree, dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (existsSync(join(path, 'package.json'))) found.push({ tree, dir: path });
      // Two levels below a fixture is as deep as any of them declares a member.
      if (depth < 3) visit(tree, path, depth + 1);
    }
  };
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const tree = join(FIXTURES, entry.name);
    if (existsSync(join(tree, 'package.json'))) found.push({ tree, dir: tree });
    visit(tree, tree, 1);
  }
  return found;
};

const asPaths = (dirs, from) =>
  dirs.map((dir) => relative(from, resolve(dir)).split('\\').join('/') || '.');

/**
 * The service directories of any coverage clone that is on this machine.
 *
 * Read from `targets.json`, which is the same list the harness measures, so
 * nothing here is a second place to keep a list of directories.
 */
const clonedTargets = () => {
  const found = [];
  const repos = join(ROOT, '.coverage-cache', 'repos');
  if (!existsSync(repos)) return found;
  const list = JSON.parse(readFileSync(join(ROOT, 'scripts', 'coverage', 'targets.json'), 'utf8'));
  for (const target of list.targets) {
    const clone = join(repos, target.name);
    if (!existsSync(join(clone, '.git'))) continue;
    for (const readRoot of target.read) found.push({ tree: clone, dir: join(clone, readRoot) });
  }
  return found;
};

const clones = clonedTargets();
let disagreements = 0;
let checked = 0;
for (const { tree, dir } of [...candidates(), ...clones]) {
  checked += 1;
  const mine = extentOf(tree, relative(tree, dir) || '.').dirs;
  const theirs = asPaths(serviceSourceDirs(dir), tree);
  const same = mine.length === theirs.length && mine.every((path, index) => path === theirs[index]);
  if (same) continue;
  disagreements += 1;
  console.error(`    ${relative(ROOT, dir)}`);
  console.error(`      the harness says: ${mine.join(', ')}`);
  console.error(`      the tool says:    ${theirs.join(', ')}`);
}

if (disagreements > 0) {
  console.error(
    `    FAIL: ${disagreements} of ${checked} directories are a different service to each of them.`,
  );
  console.error('    One of the two is wrong. Decide which, in scripts/coverage/extent.mjs or in');
  console.error('    packages/core/src/workspace.ts - never by loosening this gate.');
  process.exit(1);
}
console.log(
  `    ${checked} directories, one answer each (${clones.length} of them in a real repository)`,
);
