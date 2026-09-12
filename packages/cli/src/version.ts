import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The version of the tool, read from its own manifest.
 *
 * It was a literal until it drifted: the packages moved to `0.1.0` and this said
 * `0.0.0`, so `flowatlas --version` would have answered wrongly on the first
 * release, and every cache written by any build in that release looked current
 * to every other one.
 */
const readVersion = (): string => {
  for (const candidate of [join(here, '../package.json'), join(here, '../../package.json')]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      const { bin, version } = parsed as { bin?: unknown; version?: unknown };
      // Recognised by the command it installs rather than by its name, because
      // the name has changed once already and the version silently became
      // `0.0.0` the moment it did.
      const owns = typeof bin === 'object' && bin !== null && 'flowatlas' in bin;
      if (owns && typeof version === 'string') return version;
    } catch {
      continue;
    }
  }
  return '0.0.0';
};

export const VERSION = readVersion();

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
 * do the reading were last written. Installed from a registry those never move,
 * so this costs a few stat calls and changes nothing; in a checkout it changes
 * every time the code is rebuilt.
 */
const buildStamp = (): string => {
  const require = createRequire(import.meta.url);
  const packages = [
    '@flowatlas/core',
    '@flowatlas/extractor-nestjs',
    '@flowatlas/extractor-angular',
    '@flowatlas/adapters-db',
    '@flowatlas/adapters-entry',
    '@flowatlas/adapters-broker',
    '@flowatlas/linker',
  ];
  let newest = 0;
  for (const name of packages) {
    try {
      newest = Math.max(newest, statSync(require.resolve(name)).mtimeMs);
    } catch {
      continue;
    }
  }
  return newest === 0 ? VERSION : `${VERSION}+${Math.round(newest)}`;
};

export const BUILD_STAMP = buildStamp();
