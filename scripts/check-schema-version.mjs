#!/usr/bin/env node
/**
 * Fails when a fixture snapshot was produced by a different version of the
 * model than the one the core declares. Without this, a schema change would
 * quietly leave every snapshot describing a graph that can no longer exist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = join(root, 'packages/core/src/schema/version.ts');

const source = readFileSync(versionFile, 'utf8');
const match = /SCHEMA_VERSION\s*=\s*(\d+)/.exec(source);
if (match === null) {
  console.error(`Could not read SCHEMA_VERSION from ${versionFile}`);
  process.exit(1);
}
const expected = Number(match[1]);

const fixturesDir = join(root, 'fixtures');
let names = [];
try {
  names = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  names = [];
}

const problems = [];
let checked = 0;

/** Every snapshot a fixture may hold, whichever kind of fixture it is. */
const SNAPSHOTS = ['expected.graph.json', 'expected.project-graph.json', 'expected.link-report.json'];

for (const name of names) {
  for (const file of SNAPSHOTS) {
    const snapshot = join(fixturesDir, name, file);
    try {
      if (!statSync(snapshot).isFile()) continue;
    } catch {
      continue;
    }
    checked += 1;
    let found;
    try {
      found = JSON.parse(readFileSync(snapshot, 'utf8')).schemaVersion;
    } catch (cause) {
      problems.push(`${snapshot}: not valid JSON (${cause.message})`);
      continue;
    }
    if (found !== expected) {
      problems.push(`${snapshot}: schemaVersion ${JSON.stringify(found)}, expected ${expected}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error(`    Regenerate the snapshots, or revert the SCHEMA_VERSION bump.`);
  process.exit(1);
}

console.log(`    schema version ${expected}, ${checked} snapshot(s) agree`);
