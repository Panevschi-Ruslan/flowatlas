#!/usr/bin/env node
/**
 * I13 — every reason an extractor writes is a reason `doctor` knows.
 *
 * An unresolved row carries a `reason`, and `doctor` groups the rows by it and
 * looks each one up in the catalogue in `packages/cli/src/doctor/hints.ts`. A
 * reason no entry covers still prints: the row's own hint is used when it has
 * one, and the catalogue is consulted only when it has none. So an unregistered
 * reason is not a broken report — it is a report that reads perfectly while
 * `isKnownReason` quietly says no, which costs the heading its group would have
 * been given, the sentence a row without a hint of its own would have carried,
 * and one line in the footer that nobody reads. Two reasons reached the main
 * branch that way in one month, which is why this is a gate and not a test.
 *
 * The rows themselves are written all over `packages/*\/src`, by every adapter
 * and every extractor, and there is no single place they pass through where a
 * unit test could sweep them. So this reads the sources.
 *
 * What counts as a reason here:
 *
 *   - a `reason:` property whose value is a quoted string, or a name bound to
 *     one by a `const` in the same file — `reason: STALE_REASON` beside
 *     `const STALE_REASON = 'openapi-document-age'` is the spelling that hid an
 *     unregistered reason for a month, so a gate that could not see it would be
 *     a gate with the original hole still in it;
 *   - inside an object literal that also gives `file` and `line`. That is not a
 *     guess about intent, it is the `Unresolved` type: both are required on it
 *     and on nothing else that carries a `reason`. It is what separates a row
 *     this command will print from a `DiffWarning`, a route-match result or a
 *     dead-code verdict, all of which have a `reason` of their own and none of
 *     which ever reaches the catalogue.
 *
 * What it cannot see, written down here because a blind spot nobody has
 * recorded is the thing this gate exists to prevent:
 *
 *   - a reason assembled at run time — a template literal, a concatenation, a
 *     lookup in a table keyed by something else. Nothing in the tree does this
 *     today, and if something starts, this gate will not notice;
 *   - a name imported from another module rather than bound in the file that
 *     uses it. The `const` resolution is deliberately local;
 *   - a row built by a helper that takes the reason as an argument, where the
 *     literal sits at the call site and the `file`/`line` pair sits in the
 *     helper. Nothing does this today either.
 *
 * Tests are excluded. A test writes reasons that do not exist on purpose —
 * `hints.test.ts` asks what is said about `something-new` precisely because
 * nothing knows it — and failing on those would make the gate unwritable.
 *
 * Run from the repository root:
 *
 *   node scripts/check-doctor-reasons.mjs
 *
 * The sources are read from the working directory and the catalogue is imported
 * from beside this script, which is what lets `invariants.sh --root` point the
 * gate at a tree built to break it while still asking the real `doctor` what it
 * knows.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isKnownReason } from '../packages/cli/dist/index.js';

const root = process.cwd();
const packages = join(root, 'packages');

/** Every non-test TypeScript source under `packages/*\/src`, in a stable order. */
const sources = function* (dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
};

/**
 * The object literal a property sits directly in, as text.
 *
 * Counting braces backwards from the property to the one that is still open,
 * then forwards to its partner. A brace inside a string or a comment would
 * throw this off; none of the literals that carry a `reason` has one, and the
 * alternative is a TypeScript parser in a script whose whole point is that it
 * is cheap enough to run on every build.
 */
const literalAround = (source, at) => {
  let depth = 0;
  let open = -1;
  for (let i = at; i >= 0; i -= 1) {
    const char = source[i];
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }
  if (open < 0) return '';
  depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
};

/**
 * Whether an object literal gives a property, written either way.
 *
 * `{ file, line: site.line }` and `{ file: path, line: 1 }` are both ordinary
 * in this tree, and a check that only knew the second spelling would pass every
 * row written in the first — which is most of the adapters.
 */
const gives = (literal, name) =>
  new RegExp(String.raw`[{,\s]${name}\s*[:,}]`).test(literal);

/** Names bound to a string literal by a `const` at any depth in one file. */
const constantsIn = (source) => {
  const bound = new Map();
  const pattern = /\bconst\s+([A-Za-z_$][\w$]*)(?:\s*:[^=\n]+)?\s*=\s*'([^'\n]*)'/g;
  for (const match of source.matchAll(pattern)) bound.set(match[1], match[2]);
  return bound;
};

/** Where each reason is written, keyed by the reason, in order of discovery. */
const written = new Map();

for (const path of sources(packages)) {
  const file = relative(root, path);
  if (!/^packages\/[^/]+\/src\//.test(file.replace(/\\/g, '/'))) continue;
  const source = readFileSync(path, 'utf8');
  const bound = constantsIn(source);
  const pattern = /\breason:\s*(?:'([^'\n]*)'|([A-Za-z_$][\w$]*))/g;
  for (const match of source.matchAll(pattern)) {
    const reason = match[1] ?? bound.get(match[2]);
    if (reason === undefined || reason === '') continue;
    const literal = literalAround(source, match.index - 1);
    if (!gives(literal, 'file') || !gives(literal, 'line')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    const places = written.get(reason);
    if (places === undefined) written.set(reason, [`${file}:${line}`]);
    else places.push(`${file}:${line}`);
  }
}

const unregistered = [...written].filter(([reason]) => !isKnownReason(reason)).sort();

if (unregistered.length > 0) {
  for (const [reason, places] of unregistered) {
    // The reason on its own sends somebody to `grep`. The file that writes it
    // is what makes the fix a two-minute job, so it is printed beside it.
    console.error(`    ${reason} — written at ${places.join(', ')}`);
  }
  console.error('    FAIL: a row carries a reason doctor does not know.');
  console.error('    Register each one in packages/cli/src/doctor/hints.ts, beside the others,');
  console.error('    with the sentence a reader should act on.');
  process.exit(1);
}

console.log(`    ${written.size} reason(s) written in the sources, all registered`);
