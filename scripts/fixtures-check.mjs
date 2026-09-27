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
 * and is compared against what `flowatlas build` wrote beside them, and may hold
 * `expected.contracts-report.json`, compared against the `contracts.json` that
 * `flowatlas contracts` writes after the build.
 *
 * Timestamps and durations are ignored on both sides, since they change on every
 * run.
 *
 * A snapshot that is validated and not compared is a snapshot that is not a
 * gate, so the two counts this prints have to agree - or the fixture has to be
 * named in `VALIDATE_ONLY` below with a reason, and the gate says so out loud on
 * every run. Which fixtures can be run at all, and how, is `fixture-layout.mjs`,
 * shared with `fixtures-run.mjs`: a fixture checked against a run that never
 * happened is R120, and it happened because those two scripts each had an
 * opinion about where a fixture keeps its sources.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseProjectGraph, parseRepoGraph } from '@flowatlas/core';
import { parseContractReport } from '../packages/contracts/dist/index.js';
import { fixtureDirs, layoutOf, outputDir, root } from './fixture-layout.mjs';

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

/**
 * Fixtures whose snapshot is deliberately compared never, and why.
 *
 * The shape the read gate and I12 use, and for their reasons: an exception is a
 * named debt rather than a silent difference between two numbers, and an
 * exception that no longer applies is reported too, because one nobody has
 * removed is one nobody has re-read. Anything not in here that comes out
 * validated and uncompared fails the gate.
 */
const VALIDATE_ONLY = {
  'schema-smoke':
    'A hand-written sample of the schema itself rather than a repository: no manifest, ' +
    'no configuration, no sources, nothing for the tool to be run over. It exists so ' +
    'that a version bump has one snapshot a person wrote, and it is held to the schema ' +
    'and to nothing else.',
};

let validated = 0;
let compared = 0;
/** One entry per validated snapshot, so a gap can be named rather than counted. */
const snapshots = [];
const problems = [];

/**
 * Compares one snapshot against what the tool produced, when it has been run.
 *
 * `parse` is the schema the snapshot must satisfy: a snapshot that is not a
 * valid graph is a problem in its own right, whether or not anything ran.
 */
const check = (dir, label, expectedPath, actualPath, parse) => {
  if (!isFile(expectedPath)) {
    // The other half of the question R120 asked. A snapshot that exists but is
    // never compared was already an error; a run that writes an output nobody
    // holds a snapshot of was silently fine, so a fixture added before a kind of
    // output existed - or a new kind of output landing on fixtures that predate
    // it - went ungated with nothing said. Two fixtures were in that state the
    // day the contracts step arrived. `--update` now creates the snapshot, and
    // outside an update the gap is a failure, so it cannot be missed twice.
    if (!isFile(actualPath)) return;
    // Only an output this fixture's own steps say they write. Anything else in
    // the output directory is a leftover of some other run, and the layout table
    // is the one answer to which files a fixture of this kind produces.
    const declared = layoutOf(dir).steps.flatMap((step) => step.writes);
    if (!declared.includes(basename(actualPath))) return;
    if (UNHELD[basename(dir)] !== undefined && HELD_BACK.includes(basename(expectedPath))) return;
    if (update) {
      accept(expectedPath, actualPath);
      console.log(`created ${label}`);
      return;
    }
    problems.push(
      `${label}: a run wrote ${relative(root, actualPath)} and no snapshot holds it, so nothing compares it. ` +
        'Run with --update, read the new file, and commit it.',
    );
    return;
  }

  const snapshot = { label, fixture: basename(dir), compared: false };
  let expected;
  let stale;
  try {
    expected = parse(JSON.parse(readFileSync(expectedPath, 'utf8')));
    validated += 1;
    snapshots.push(snapshot);
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
  snapshot.compared = true;

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

/**
 * Project fixtures whose project graph and link report are deliberately held by
 * no snapshot yet, and why.
 *
 * The rule above found nine project fixtures held by their repository graph
 * alone. Each was read against its README before its outputs became an
 * expectation (R138), and the ones that read wrong were named here: a snapshot
 * taken then would have written the disagreement into the gate as the right
 * answer. Each entry named what was wrong, so the entry was a debt with a reason
 * rather than a hole.
 *
 * Empty since R140, which settled the last three - `multi-repo-analytics`,
 * `nest-kafka` and `nest-types` - each by deciding whether the reader or the
 * README was right, and not by taking the output. The mechanism stays, because
 * the next fixture whose output contradicts its README needs somewhere to wait
 * that is not a snapshot.
 *
 * The same shape as `VALIDATE_ONLY`, and for its reason: an exception that no
 * longer applies is reported too. An entry whose fixture now holds either
 * snapshot fails the gate - somebody resolved it and has to remove the name, or
 * somebody snapshotted a disagreement and has to look again.
 */
const UNHELD = {};

/** The outputs an `UNHELD` entry holds back: everything a build writes. */
const HELD_BACK = ['expected.project-graph.json', 'expected.link-report.json'];

/** What a snapshot is compared against, one row per file the tool writes. */
const SNAPSHOTS = [
  ['expected.graph.json', 'graph.json', parseRepoGraph],
  ['expected.project-graph.json', 'project-graph.json', parseProjectGraph],
  ['expected.link-report.json', 'link-report.json', asReport],
  // Not `expected.contracts.json`: in multi-repo-contracts that name already
  // holds what `contracts --format json` prints, which `cli-snapshots.mjs`
  // records, and the printed report is ordered for a reader while the file is
  // in the order the check produced it. Same findings, different bytes, so
  // the two cannot share a name.
  ['expected.contracts-report.json', 'contracts.json', parseContractReport],
];

const visited = new Set();

for (const dir of fixtureDirs(selected)) {
  const label = relative(root, dir);
  visited.add(basename(dir));
  // Where a run over this fixture writes, whatever its layout. A fixture of no
  // kind has no such directory, so its snapshot comes out uncompared and the
  // reconciliation below insists on a reason for it.
  const out = outputDir(dir);
  for (const [expected, actual, parse] of SNAPSHOTS) {
    check(dir, `${label}/${expected}`, join(dir, expected), join(out, actual), parse);
  }
}

/**
 * The gap between the two counts, named.
 *
 * Under `--update` every uncompared snapshot is one a run has not been done for
 * yet, which is the state `--update` exists to leave, so this only runs when the
 * gate is being asked for a verdict.
 */
const validateOnly = [];
if (!update) {
  const gaps = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.compared) continue;
    const found = gaps.get(snapshot.fixture) ?? [];
    found.push(snapshot.label);
    gaps.set(snapshot.fixture, found);
  }
  for (const [fixture, labels] of gaps) {
    const why = VALIDATE_ONLY[fixture];
    if (why !== undefined) {
      validateOnly.push(`  validate-only ${fixture}: ${why}`);
      continue;
    }
    // Two ways to get here, and they need different sentences: a fixture the
    // tool cannot be run over at all, and one that simply has not been run.
    const remedy =
      layoutOf(join(root, 'fixtures', fixture)).kind === 'none'
        ? `nothing in fixtures/${fixture} declares how it is produced - give it a manifest or a configuration`
        : 'run `pnpm fixtures:run` first';
    problems.push(
      `${labels.join('\n    ')}\n    validated but compared never: ${remedy}, ` +
        'or name the fixture in VALIDATE_ONLY with the reason.',
    );
  }
  for (const fixture of Object.keys(VALIDATE_ONLY)) {
    if (visited.has(fixture) && !gaps.has(fixture)) {
      problems.push(
        `fixtures/${fixture}: named in VALIDATE_ONLY, but every snapshot of it was compared. Remove the entry.`,
      );
    }
  }
}

/**
 * `UNHELD`, reconciled the way `VALIDATE_ONLY` is: every entry is said out loud,
 * and one that no longer holds anything back is a failure rather than a
 * leftover. Not only under a verdict: `--update` never creates a held-back
 * snapshot, so one that exists was put there by hand, and that is the moment to
 * be told.
 */
const unheld = [];
for (const [fixture, why] of Object.entries(UNHELD)) {
  if (!visited.has(fixture)) {
    // Checking one fixture says nothing about another; checking all of them
    // and not finding this one means the entry names nothing.
    if (selected.length === 0) {
      problems.push(`fixtures/${fixture}: named in UNHELD, but there is no such fixture. Remove the entry.`);
    }
    continue;
  }
  const held = HELD_BACK.filter((name) => isFile(join(root, 'fixtures', fixture, name)));
  if (held.length > 0) {
    problems.push(
      `fixtures/${fixture}: named in UNHELD, but ${held.join(' and ')} now exist${held.length === 1 ? 's' : ''}. ` +
        'If what it held back is resolved, remove the entry; if not, the snapshot has taken the wrong answer as the expectation.',
    );
    continue;
  }
  unheld.push(`  unheld ${fixture}: ${why}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}

console.log(`fixtures ok: ${compared} compared, ${validated} validated`);
for (const line of validateOnly) console.log(line);
for (const line of unheld) console.log(line);
