/**
 * Graphs of commits, kept so a second comparison against the same base is free.
 *
 * Keyed on the commit, never on the ref: a branch moves and a commit does not,
 * which is the fault R10 was about from the other side — a key that never moved
 * served an answer from a build that no longer existed. A commit is immutable,
 * so the only thing left to invalidate on is the reader: a schema this graph
 * was not written for, or a build of the tool that would read the same commit
 * differently.
 *
 * It lives under the project's own output directory rather than beside any
 * repository, which is what keeps two revisions of one repository from writing
 * over each other (R14).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, parseRepoGraph, type RepoGraph } from '@flowatlas/core';
import { BUILD_STAMP } from '../version.js';

/** What a cached graph was, so a later run can tell whether it may be used. */
export interface CacheMeta {
  service: string;
  /** Path of the repository as the configuration wrote it. */
  repo: string;
  sha: string;
  /** The ref that named this commit when it was read. Descriptive only. */
  ref: string | null;
  extractedAt: string;
  schemaVersion: number;
  /**
   * The build of the tool that read it.
   *
   * `BUILD_STAMP` rather than the version, for R10's reason: within a release
   * the version never moves, so a graph read before a change to what the tool
   * finds would otherwise be handed back afterwards, unchanged and wrong.
   */
  flowatlasVersion: string;
  nodeModules: 'linked' | 'present' | 'missing';
}

export interface CacheEntry {
  graph: RepoGraph;
  meta: CacheMeta;
}

/** One directory of `<output>/cache/`, as `flowatlas cache ls` reads it. */
export interface CacheRow {
  sha: string;
  service: string;
  repo: string;
  ref: string | null;
  extractedAt: string;
  bytes: number;
  /** True when this run of the tool would still accept it. */
  usable: boolean;
}

const GRAPH = 'graph.json';
const META = 'meta.json';

const bytesOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** A temporary nothing else could be writing: two runs must not take one name. */
const temporaryFor = (path: string): string => `${path}.${process.pid}.tmp`;

const writeJson = (path: string, value: unknown): void => {
  const temporary = temporaryFor(path);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
};

export class GraphCache {
  readonly root: string;

  constructor(outputDir: string) {
    this.root = join(outputDir, 'cache');
  }

  directoryFor(sha: string): string {
    return join(this.root, sha);
  }

  /**
   * The graph read from this commit, when there is one this run may believe.
   *
   * A directory recording another repository under the same commit is a miss
   * rather than an error: shas do not collide in practice, and if they ever did
   * the honest answer is to read the repository again.
   */
  get(sha: string, service: string, repo: string): CacheEntry | null {
    const dir = this.directoryFor(sha);
    try {
      const meta = JSON.parse(readFileSync(join(dir, META), 'utf8')) as CacheMeta;
      if (meta.schemaVersion !== SCHEMA_VERSION) return null;
      if (meta.flowatlasVersion !== BUILD_STAMP) return null;
      if (meta.service !== service || meta.repo !== repo) return null;
      const graph = parseRepoGraph(JSON.parse(readFileSync(join(dir, GRAPH), 'utf8')));
      return { graph, meta };
    } catch {
      return null;
    }
  }

  put(entry: { sha: string; service: string; repo: string; ref: string | null; graph: RepoGraph; nodeModules: CacheMeta['nodeModules'] }): CacheMeta {
    const dir = this.directoryFor(entry.sha);
    mkdirSync(dir, { recursive: true });
    const meta: CacheMeta = {
      service: entry.service,
      repo: entry.repo,
      sha: entry.sha,
      ref: entry.ref,
      extractedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      flowatlasVersion: BUILD_STAMP,
      nodeModules: entry.nodeModules,
    };
    writeJson(join(dir, GRAPH), entry.graph);
    writeJson(join(dir, META), meta);
    return meta;
  }

  /** Every entry, newest first, whether or not this run would accept it. */
  list(): CacheRow[] {
    if (!existsSync(this.root)) return [];
    const rows: CacheRow[] = [];
    for (const name of readdirSync(this.root)) {
      const dir = join(this.root, name);
      try {
        const meta = JSON.parse(readFileSync(join(dir, META), 'utf8')) as CacheMeta;
        rows.push({
          sha: meta.sha,
          service: meta.service,
          repo: meta.repo,
          ref: meta.ref,
          extractedAt: meta.extractedAt,
          bytes: bytesOf(join(dir, GRAPH)),
          usable: meta.schemaVersion === SCHEMA_VERSION && meta.flowatlasVersion === BUILD_STAMP,
        });
      } catch {
        // A half-written directory is not a cache entry. It is listed as one
        // nothing can read, so `prune` can still take it away.
        rows.push({
          sha: name,
          service: '?',
          repo: '?',
          ref: null,
          extractedAt: '',
          bytes: bytesOf(join(dir, GRAPH)),
          usable: false,
        });
      }
    }
    return rows.sort((a, b) => (a.extractedAt < b.extractedAt ? 1 : a.extractedAt > b.extractedAt ? -1 : 0));
  }

  /** Keeps the newest `keep` entries and removes the rest. Returns what went. */
  prune(keep: number): CacheRow[] {
    const rows = this.list();
    const dropped = rows.slice(Math.max(keep, 0));
    for (const row of dropped) rmSync(join(this.root, row.sha), { recursive: true, force: true });
    return dropped;
  }

  clear(): number {
    const rows = this.list();
    rmSync(this.root, { recursive: true, force: true });
    return rows.length;
  }
}
