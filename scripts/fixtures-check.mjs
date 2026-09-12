#!/usr/bin/env node
/**
 * Validates fixture snapshots and, where a run has been done, compares it
 * against the snapshot.
 *
 *   node scripts/fixtures-check.mjs [fixtures/<name> ...] [--update]
 *
 * Two kinds of fixture. A single repository holds `expected.graph.json` and is
 * compared against `<fixture>/.flowatlas/graph.json` from `flowatlas extract`. A
 * project holds `expected.project-graph.json` and `expected.link-report.json`
 * and is compared against what `flowatlas build` wrote beside them.
 *
 * A fixture that has not been run is validated but not compared. Timestamps and
 * durations are ignored on both sides, since they change on every run.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProjectGraph, parseRepoGraph } from '@flowatlas/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const update = args.includes('--update');
const selected = args.filter((arg) => !arg.startsWith('--'));

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const fixtureDirs = () => {
  if (selected.length > 0) return selected.map((path) => join(root, path));
  try {
    return readdirSync(join(root, 'fixtures'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, 'fixtures', entry.name));
  } catch {
    return [];
  }
};

/** Everything that legitimately differs between two runs of the same input. */
const stable = (value) => {
  const { generatedAt: _generated, builtAt: _built, ...rest } = value;
  if (!Array.isArray(rest.services)) return rest;
  return {
    ...rest,
    services: rest.services.map(({ durationMs: _duration, ...service }) => service),
  };
};

/** Longest common subsequence, so insertions do not shift the whole report. */
const diffLines = (before, after) => {
  const lengths = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        before[i] === after[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push(`- ${before[i]}`);
      i += 1;
    } else {
      out.push(`+ ${after[j]}`);
      j += 1;
    }
  }
  for (; i < before.length; i += 1) out.push(`- ${before[i]}`);
  for (; j < after.length; j += 1) out.push(`+ ${after[j]}`);
  return out;
};

let validated = 0;
let compared = 0;
const problems = [];

/**
 * Compares one snapshot against what the tool produced, when it has been run.
 *
 * `parse` is the schema the snapshot must satisfy: a snapshot that is not a
 * valid graph is a problem in its own right, whether or not anything ran.
 */
const check = (label, expectedPath, actualPath, parse) => {
  if (!isFile(expectedPath)) return;

  let expected;
  let stale;
  try {
    expected = parse(JSON.parse(readFileSync(expectedPath, 'utf8')));
    validated += 1;
  } catch (cause) {
    // A snapshot the schema no longer accepts is what `--update` is for: after
    // a version bump every one of them fails here, and refusing to rewrite them
    // meant copying two dozen files by hand. Outside an update it is still a
    // problem in its own right.
    if (!update) {
      problems.push(`${label}: snapshot is not valid\n    ${cause.message}`);
      return;
    }
    stale = cause.message;
  }

  if (!isFile(actualPath)) {
    if (stale !== undefined) problems.push(`${label}: snapshot is not valid and nothing was run\n    ${stale}`);
    return;
  }

  let actual;
  try {
    actual = parse(JSON.parse(readFileSync(actualPath, 'utf8')));
  } catch (cause) {
    problems.push(`${label}: output is not valid\n    ${cause.message}`);
    return;
  }
  if (stale !== undefined) {
    accept(expectedPath, actualPath);
    console.log(`updated ${label} (was: ${stale})`);
    return;
  }
  compared += 1;

  const before = JSON.stringify(stable(expected), null, 2).split('\n');
  const after = JSON.stringify(stable(actual), null, 2).split('\n');
  if (before.join('\n') === after.join('\n')) return;

  if (update) {
    accept(expectedPath, actualPath);
    console.log(`updated ${label}`);
    return;
  }
  const diff = diffLines(before, after);
  const shown = diff.slice(0, 60).join('\n');
  const more = diff.length > 60 ? `\n... and ${diff.length - 60} more lines` : '';
  problems.push(`${label}: output differs from the snapshot\n${shown}${more}`);
};

/**
 * Takes the output as the snapshot, byte for byte.
 *
 * Not the parsed object: writing that back put every key in the schema's order
 * rather than the tool's, so a one-line change arrived as a hundred moved lines
 * and nobody could read the diff that is the whole point of a snapshot.
 */
const accept = (expectedPath, actualPath) => {
  writeFileSync(expectedPath, readFileSync(actualPath, 'utf8'));
};

/** The report is JSON with counts rather than a graph, so it is taken as read. */
const asReport = (value) => {
  if (typeof value?.schemaVersion !== 'number' || typeof value?.httpOut !== 'object') {
    throw new Error('not a link report');
  }
  return value;
};

const hasSources = (dir) => {
  try {
    return statSync(join(dir, 'src')).isDirectory();
  } catch {
    return false;
  }
};

for (const dir of fixtureDirs()) {
  const label = relative(root, dir);
  // A fixture with no sources cannot be produced by running the tool. The one
  // that exists is a hand-written sample of the schema itself, so it is checked
  // against the schema and never against an extraction.
  const flowatlas = hasSources(dir) || isFile(join(dir, 'flowatlas.config.json')) ? join(dir, '.flowatlas') : join(dir, '.none');
  check(
    `${label}/expected.graph.json`,
    join(dir, 'expected.graph.json'),
    join(flowatlas, 'graph.json'),
    parseRepoGraph,
  );
  check(
    `${label}/expected.project-graph.json`,
    join(dir, 'expected.project-graph.json'),
    join(flowatlas, 'project-graph.json'),
    parseProjectGraph,
  );
  check(
    `${label}/expected.link-report.json`,
    join(dir, 'expected.link-report.json'),
    join(flowatlas, 'link-report.json'),
    asReport,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}

console.log(`fixtures ok: ${compared} compared, ${validated} validated`);
