import { statSync } from 'node:fs';
import { checkoutLine, checkoutsMoved, citedFiles, freshnessPathFor, readFreshness, staleOf, type Freshness, type Stale } from '@flowatlas/core';

/** What the server knows of one database's freshness file, read again when the file changes. */
interface Read {
  mtimeMs: number;
  freshness: Freshness | undefined;
}

const reads = new Map<string, Read>();

/**
 * The freshness a build wrote beside the database at `dbPath`, read again only
 * when its timestamp moves: every answer asks, and a rebuild writes a new one.
 */
export const freshnessBeside = (dbPath: string): Freshness | undefined => {
  const path = freshnessPathFor(dbPath);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    reads.delete(path);
    return undefined;
  }
  const known = reads.get(path);
  if (known !== undefined && known.mtimeMs === mtimeMs) return known.freshness;
  const freshness = readFreshness(dbPath);
  reads.set(path, { mtimeMs, freshness });
  return freshness;
};

/** `stale` as an answer says it: which of its files changed since the build, and what to do. */
export type StaleRef = Stale & { fix: string; rebuilding?: true };

/**
 * Whether the files an answer cites changed since the graph was built (P230):
 * `stale` beside the answer when any did, and nothing when none did, so a
 * fresh answer does not grow (D2).
 */
export const staleFor = (dbPath: string, answer: object): StaleRef | undefined => {
  const stale = staleOf(freshnessBeside(dbPath), citedFiles(answer));
  return stale === undefined ? undefined : { ...stale, fix: 'run flowatlas build' };
};

/**
 * The answer with `stale` beside it when its files moved, and `rebuilding`
 * when that started a background build (`mcp.rebuild: on-change`); the answer
 * itself otherwise.
 */
export const withStale = (handle: { path: string; onStale?: (() => boolean) | undefined }, answer: object): object => {
  if (typeof (answer as { error?: unknown }).error === 'string') return answer;
  const stale = staleFor(handle.path, answer);
  if (stale === undefined) return answer;
  const rebuilding = handle.onStale?.() === true;
  return { ...answer, stale: rebuilding ? { ...stale, rebuilding: true } : stale };
};

/** One line per service whose checkout moved since the build: another commit, or another branch. */
export const checkoutLines = (dbPath: string): string[] => checkoutsMoved(freshnessBeside(dbPath)).map(checkoutLine);
