#!/usr/bin/env node
/**
 * Removes every build output, so the next build is about the tree.
 *
 *   node scripts/clean.mjs
 *
 * `pnpm check` runs this first. Without it the compiler reads the state file it
 * left in `dist` last time, reports that nothing needs doing, and every gate
 * after it reads output the current sources could not produce. That happened:
 * a merge added a package, the link for it was missing, and the whole of `check`
 * went green on a tree where one package did not compile at all.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let removed = 0;

for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = join(root, 'packages', entry.name);
  for (const name of ['dist']) {
    const path = join(pkg, name);
    try {
      statSync(path);
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      continue;
    }
  }
  for (const file of readdirSync(pkg)) {
    if (!file.endsWith('.tsbuildinfo')) continue;
    rmSync(join(pkg, file), { force: true });
    removed += 1;
  }
}

console.log(`cleaned ${removed} build output(s)`);
