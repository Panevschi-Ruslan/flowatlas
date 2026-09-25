#!/usr/bin/env node
/**
 * I12 — no extractor can be built only by building another extractor.
 *
 * The extractors are siblings. Each one reads the repositories of one ecosystem
 * and none of them is above any other, so none of them should be able to name
 * another, directly or through anything it depends on. Nothing cyclic is needed
 * for this to hurt: the day the Angular reader borrowed the broker adapter's
 * channel-name resolution it acquired the Nest extractor as a build dependency,
 * and the argument for keeping extractors independent got harder to make (R46).
 *
 * The check is on the manifests rather than on the imports, because the
 * manifest is what a build actually follows: a package that names another in
 * its dependencies cannot be built without it, whichever files import what.
 * Work shared between extractors belongs in a package neither of them owns —
 * `@flowatlas/core` when it names no technology at all, and
 * `@flowatlas/extract-scopes` when it is about extraction but about no
 * framework.
 *
 * Run from the repository root:
 *
 *   node scripts/check-extractor-siblings.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = join(process.cwd(), 'packages');
const isExtractor = (name) => name.startsWith('@flowatlas/extractor-');

/**
 * Chains this check knows about and does not fail on.
 *
 * Each one is a debt with a name, not a decision. Listing the two ends rather
 * than the edge in the middle is deliberate: exempting the edge would exempt
 * everything behind it, so a second extractor appearing down the same path
 * would arrive unnoticed. A pair goes stale the moment the chain is cut, and a
 * stale pair is reported too — an exemption nobody has removed is an exemption
 * nobody has re-read.
 */
const ALLOWED = [
  {
    from: '@flowatlas/extractor-react',
    to: '@flowatlas/extractor-nestjs',
    why:
      '@flowatlas/adapters-entry names the Nest extractor for `decoratorArgs`, ' +
      '`findDecorators` and `stableKey`, all three of which that package only ' +
      're-exports from @flowatlas/core. Cutting it is a change to adapters-entry ' +
      'and was out of scope for R46, which cut the Angular chain.',
  },
];

const manifests = new Map();
for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(PACKAGES, entry.name, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  // Only what a build follows. A devDependency is what the tests and the
  // bundler need, and neither is part of the package a consumer gets.
  manifests.set(pkg.name, Object.keys(pkg.dependencies ?? {}));
}

/** The first path from one package to another, or undefined when there is none. */
const pathBetween = (from, to) => {
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    for (const next of manifests.get(path[path.length - 1]) ?? []) {
      if (next === to) return [...path, next];
      if (!manifests.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return undefined;
};

const problems = [];
const extractors = [...manifests.keys()].filter(isExtractor).sort();

for (const from of extractors) {
  for (const to of extractors) {
    if (from === to) continue;
    const path = pathBetween(from, to);
    const allowed = ALLOWED.find((one) => one.from === from && one.to === to);
    if (path === undefined) {
      if (allowed !== undefined) {
        problems.push(
          `${from} no longer reaches ${to}: remove that pair from ALLOWED (${allowed.why})`,
        );
      }
      continue;
    }
    if (allowed !== undefined) continue;
    problems.push(`${path.join(' -> ')}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('    FAIL: an extractor can be reached from a sibling extractor.');
  console.error('    Move the shared part into @flowatlas/core or @flowatlas/extract-scopes,');
  console.error('    or write the chain into ALLOWED with the reason it is still there.');
  process.exit(1);
}

console.log(`    ${extractors.length} extractors, none reachable from another`);
