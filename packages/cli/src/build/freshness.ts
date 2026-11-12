import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { FRESHNESS_FILE, FRESHNESS_FORMAT_VERSION, headOf, type Freshness, type FreshnessService } from '@flowatlas/core';
import type { BuildCache } from './cache.js';

/**
 * Whether a tracked file under `dir` differs from HEAD, asked of git once per
 * directory. Not a checkout, no git, or too slow to say: not dirty, since
 * nothing here can say it is.
 */
const isDirty = (dir: string): boolean => {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', '.'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return out.trim() !== '';
  } catch {
    return false;
  }
};

/**
 * Writes `freshness.json` beside the database (P230): each service's checkout
 * and every file it was read from, as the cache recorded them, so an answer
 * can say which of the files it cites changed since. Written whole and moved
 * into place, so a reader never sees half of one.
 */
export const writeFreshness = (outputDir: string, builtAt: string, cache: BuildCache, dirOf: (service: string) => string): void => {
  const asked = new Map<string, { commit: string | null; branch: string | null; dirty: boolean }>();
  const services: Record<string, FreshnessService> = {};
  for (const [name, repo] of Object.entries(cache.repos).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const dir = dirOf(name);
    let checkout = asked.get(dir);
    if (checkout === undefined) {
      const head = headOf(dir);
      checkout = { ...head, dirty: head.commit !== null && isDirty(dir) };
      asked.set(dir, checkout);
    }
    services[name] = {
      dir,
      ...checkout,
      files: Object.fromEntries(Object.entries(repo.files).map(([file, stamp]) => [file, [stamp.size, stamp.mtimeMs, stamp.hash]])),
    };
  }
  const freshness: Freshness = { freshnessFormatVersion: FRESHNESS_FORMAT_VERSION, builtAt, services };
  const path = join(outputDir, FRESHNESS_FILE);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(freshness)}\n`, 'utf8');
  renameSync(temporary, path);
};
