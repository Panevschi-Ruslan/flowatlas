import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FlowatlasConfig } from '@flowatlas/core';
import { z } from 'zod';

/**
 * Bumped like `SCHEMA_VERSION`, and for the same reason: a cache written by an
 * older shape must be ignored rather than half understood.
 */
export const CACHE_VERSION = 1;

export const CACHE_FILENAME = 'cache.json';

const fileStampSchema = z.strictObject({
  hash: z.string().min(1),
  size: z.number().int().min(0),
  mtimeMs: z.number(),
  /** Repo-relative paths this file imports, so a watch never re-walks imports. */
  deps: z.array(z.string()).default([]),
});

const repoCacheSchema = z.strictObject({
  /** Path as written in the configuration, so a moved repository invalidates. */
  repo: z.string(),
  extractor: z.string(),
  adapters: z.array(z.string()),
  tsconfigHash: z.string(),
  packageJsonHash: z.string(),
  globalFiles: z.array(z.string()),
  files: z.record(z.string(), fileStampSchema),
  graphPath: z.string(),
  graphHash: z.string(),
  counts: z.strictObject({
    nodes: z.number().int().min(0),
    edges: z.number().int().min(0),
    types: z.number().int().min(0),
    unresolved: z.number().int().min(0),
  }),
});

export const buildCacheSchema = z.strictObject({
  cacheVersion: z.number().int(),
  schemaVersion: z.number().int(),
  flowatlasVersion: z.string(),
  extractors: z.record(z.string(), z.string()),
  configHash: z.string(),
  builtAt: z.string(),
  repos: z.record(z.string(), repoCacheSchema),
});

export type FileStamp = z.infer<typeof fileStampSchema>;
export type RepoCache = z.infer<typeof repoCacheSchema>;
export type BuildCache = z.infer<typeof buildCacheSchema>;

/** Why a cache was thrown away, printed as `cache-invalid:<why>`. */
export type CacheProblem = 'version' | 'schema' | 'extractor' | 'config' | 'corrupt';

/** What the installed tool would write today; a cache that disagrees is stale. */
export interface CacheExpectations {
  schemaVersion: number;
  flowatlasVersion: string;
  extractors: Record<string, string>;
  configHash: string;
}

export const hashText = (text: string): string =>
  `sha1:${createHash('sha1').update(text).digest('hex')}`;

/** Content hash of a file, or of emptiness when there is no file to read. */
export const hashFile = (path: string): string => {
  try {
    return hashText(readFileSync(path, 'utf8'));
  } catch {
    return hashText('');
  }
};

/**
 * Hash of the configuration, over its keys in a fixed order.
 *
 * Another tool rewriting the file with its keys reordered says nothing about
 * the analysis, so it must not force every repository to be read again.
 */
export const hashConfig = (config: FlowatlasConfig): string => hashText(canonical(config));

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const cachePathFor = (outputDir: string): string => join(outputDir, CACHE_FILENAME);

/**
 * Reads the cache, or reports why it cannot be used.
 *
 * The cache is an accelerator and never a source of truth, so every failure
 * ends in the same place: no cache, a note on stderr, and a full build.
 */
export const loadBuildCache = (
  path: string,
  expected?: CacheExpectations,
): { cache: BuildCache } | { problem: CacheProblem } | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ENOENT' ? null : { problem: 'corrupt' };
  }

  const parsed = buildCacheSchema.safeParse(raw);
  if (!parsed.success) return { problem: 'corrupt' };
  if (parsed.data.cacheVersion !== CACHE_VERSION) return { problem: 'version' };
  if (expected === undefined) return { cache: parsed.data };

  const problem = staleAgainst(parsed.data, expected);
  return problem === undefined ? { cache: parsed.data } : { problem };
};

/** The whole-cache invalidation rules, in the order their reasons are reported. */
const staleAgainst = (cache: BuildCache, expected: CacheExpectations): CacheProblem | undefined => {
  if (cache.schemaVersion !== expected.schemaVersion) return 'schema';
  if (cache.flowatlasVersion !== expected.flowatlasVersion) return 'extractor';
  for (const [name, version] of Object.entries(expected.extractors)) {
    if (cache.extractors[name] !== version) return 'extractor';
  }
  if (cache.configHash !== expected.configHash) return 'config';
  return undefined;
};

/**
 * A temporary beside the file, named after who is writing it.
 *
 * Kept ending in `.tmp` so a run cut short still leaves something the next one
 * recognises and clears.
 */
let written = 0;
export const temporaryFor = (path: string): string => `${path}.${process.pid}.${(written += 1)}.tmp`;

/**
 * Written through a temporary file, so a run cut short leaves the old cache.
 *
 * The temporary carries the process that wrote it, because the name used to be
 * shared: two runs over one repository each wrote `cache.json.tmp`, each renamed
 * it, and the second found the first had already taken it. That was one
 * whole-suite run in four.
 *
 * The rename replaces the old file by itself; removing it first only opened a
 * moment where a reader would find nothing there.
 */
export const saveBuildCache = (path: string, cache: BuildCache): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = temporaryFor(path);
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
};

export const emptyCache = (expected: CacheExpectations, builtAt: string): BuildCache => ({
  cacheVersion: CACHE_VERSION,
  schemaVersion: expected.schemaVersion,
  flowatlasVersion: expected.flowatlasVersion,
  extractors: { ...expected.extractors },
  configHash: expected.configHash,
  builtAt,
  repos: {},
});

export interface DiffOptions {
  /**
   * Skip reading a file whose size and modification time are unchanged.
   *
   * Only honoured under `--watch`, where the previous stamp was taken by this
   * same process seconds ago. A cold build hashes everything, because a
   * checkout changes modification times without changing content and the other
   * way round.
   */
  trustTimestamps?: boolean;
}

/** Size and modification time of a file, without reading it. */
const statOf = (path: string): { size: number; mtimeMs: number } | undefined => {
  try {
    const stat = statSync(path);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
};

/**
 * Stamps the current files of a repository, reusing hashes where allowed.
 *
 * `deps` are carried over from the previous stamp of a file that did not
 * change, because the imports of an unchanged file are unchanged too.
 */
export const stampFiles = (
  repoDir: string,
  files: readonly string[],
  previous: Record<string, FileStamp> | undefined,
  options: DiffOptions = {},
): Record<string, FileStamp> => {
  const out: Record<string, FileStamp> = {};
  for (const file of [...files].sort()) {
    const path = join(repoDir, file);
    const stat = statOf(path);
    const before = previous?.[file];
    const unchanged =
      options.trustTimestamps === true &&
      before !== undefined &&
      stat !== undefined &&
      before.size === stat.size &&
      before.mtimeMs === stat.mtimeMs;
    out[file] = unchanged
      ? { ...before }
      : {
          hash: hashFile(path),
          size: stat?.size ?? 0,
          mtimeMs: stat?.mtimeMs ?? 0,
          deps: before?.deps ?? [],
        };
  }
  return out;
};

export interface FileDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** What changed in one repository since the cache was written. */
export const diffRepoFiles = (
  entry: Pick<RepoCache, 'files'> | undefined,
  current: Record<string, FileStamp>,
): FileDiff => {
  const before = entry?.files ?? {};
  const added: string[] = [];
  const changed: string[] = [];
  for (const [file, stamp] of Object.entries(current)) {
    const was = before[file];
    if (was === undefined) added.push(file);
    else if (was.hash !== stamp.hash) changed.push(file);
  }
  const removed = Object.keys(before).filter((file) => current[file] === undefined);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
};
