import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACTORS } from './build/extractor.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The scope every package of this tool is published under. */
const SCOPE = '@flowatlas/';

interface Manifest {
  bin?: unknown;
  version?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * This command's own manifest.
 *
 * Recognised by the command it installs rather than by its name, because the
 * name has changed once already and everything read from here silently became
 * a default the moment it did.
 */
const ownManifest = (): Manifest | undefined => {
  for (const candidate of [join(here, '../package.json'), join(here, '../../package.json')]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      const manifest = parsed as Manifest;
      const { bin } = manifest;
      if (typeof bin === 'object' && bin !== null && 'flowatlas' in bin) return manifest;
    } catch {
      continue;
    }
  }
  return undefined;
};

const MANIFEST = ownManifest();

/**
 * The version of the tool, read from its own manifest.
 *
 * It was a literal until it drifted: the packages moved to `0.1.0` and this said
 * `0.0.0`, so `flowatlas --version` would have answered wrongly on the first
 * release, and every cache written by any build in that release looked current
 * to every other one.
 */
export const VERSION = typeof MANIFEST?.version === 'string' ? MANIFEST.version : '0.0.0';

/**
 * Every package whose build output decides what a read produces.
 *
 * Derived, and that is the whole point of it. It was eight names written out by
 * hand, and a hand-written list of what the tool is made of is the same defect
 * as a hand-written version: it is right on the day it is written and nobody
 * finds out the day it stops being. A new reader package was added, this list
 * was not, and a tool rebuilt with it answered from yesterday's cache — a real
 * change read as no change, which is the one answer a cache must never give.
 *
 * Two sources, because there are two kinds of reader and neither knows the
 * other. `EXTRACTORS` is the table that says which package reads which kind of
 * repository, so a reader added there is counted here with no second edit —
 * that is what the test holds. The rest are the packages every read goes
 * through whatever the repository is, and no table names them; they are taken
 * from this command's own dependencies, which they must be in to be imported at
 * all. Over-counting is free — a stamp that moves when nothing changed costs one
 * re-read — and under-counting is the bug.
 */
export const READER_PACKAGES: readonly string[] = [
  ...new Set([
    ...Object.values(EXTRACTORS),
    ...Object.keys({ ...MANIFEST?.dependencies, ...MANIFEST?.devDependencies }).filter((name) =>
      name.startsWith(SCOPE),
    ),
  ]),
].sort();

/**
 * When the given packages were last built, as a stamp on top of the version.
 *
 * `mtimeOf` is a parameter so that a test can say what "rebuilt" means without
 * touching the files this process is running from.
 */
export const stampOf = (
  packages: readonly string[],
  mtimeOf: (name: string) => number | undefined,
): string => {
  let newest = 0;
  for (const name of packages) {
    newest = Math.max(newest, mtimeOf(name) ?? 0);
  }
  return newest === 0 ? VERSION : `${VERSION}+${Math.round(newest)}`;
};

/** When a package's built entry point was last written, where there is one. */
export const builtAt = (name: string): number | undefined => {
  const require = createRequire(import.meta.url);
  try {
    return statSync(require.resolve(name)).mtimeMs;
  } catch {
    return undefined;
  }
};

/**
 * What build of the tool is running, as far as the cache is concerned.
 *
 * The version alone is not enough. Within one release it never moves, so a cache
 * written by yesterday's build of the extractor is accepted by today's, and a
 * change to what the tool reads shows up as no change at all. That is not a
 * problem for somebody who installed the tool, and it is the normal state for
 * anybody working on it — which is exactly who most needs the answer to be
 * current.
 *
 * The build itself is the fingerprint: when the files behind the packages that
 * do the reading were last written. Installed from a registry those are bundled
 * into this one and resolve to nothing, so the version stands alone; in a
 * checkout it changes every time any of them is rebuilt.
 */
export const BUILD_STAMP = stampOf(READER_PACKAGES, builtAt);
