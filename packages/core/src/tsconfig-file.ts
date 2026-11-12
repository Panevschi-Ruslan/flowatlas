import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Which tsconfig a directory is compiled with, as a question about files alone.
 *
 * In a module of its own because two layers ask it: the project reader, which
 * opens the program, and the workspace reader, which asks whether a directory
 * with no manifest is an application its workspace builds (R180). The second is
 * below the first, so the answer cannot live in the first.
 */

/** Tried in order when the caller does not name one. */
export const TSCONFIG_CANDIDATES = [
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.app.json',
] as const;

export const findTsconfig = (rootDir: string, tsconfig?: string): string | undefined => {
  if (tsconfig !== undefined) {
    const path = isAbsolute(tsconfig) ? tsconfig : join(rootDir, tsconfig);
    return existsSync(path) ? path : undefined;
  }
  for (const candidate of TSCONFIG_CANDIDATES) {
    const path = join(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
};
