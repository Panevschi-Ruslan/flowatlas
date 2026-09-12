import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A file that ships with this command, found wherever the command is running
 * from.
 *
 * There are three layouts and they are all real. Running from source, this
 * module sits at `src/`; running from a `tsc` build it sat at `dist/commands/`;
 * running from the published command it is `dist/index.js`, one file, with no
 * directory depth left to walk up. A path written for one of those is wrong in
 * the other two, and the way it is wrong is a child process that cannot start
 * or a template that is not there — both a long way from the line that computed
 * the path.
 *
 * So the candidates are tried in order and the first that exists wins.
 */
export const shipped = (importMetaUrl: string, ...candidates: string[]): string => {
  const here = dirname(fileURLToPath(importMetaUrl));
  for (const candidate of candidates) {
    const path = resolve(here, candidate);
    if (existsSync(path)) return path;
  }
  return resolve(here, candidates[0] as string);
};

/** The command itself, for the places that run it in a process of its own. */
export const ownBin = (importMetaUrl: string): string =>
  shipped(importMetaUrl, '../bin/flowatlas.js', '../../bin/flowatlas.js', join('..', '..', '..', 'bin', 'flowatlas.js'));
