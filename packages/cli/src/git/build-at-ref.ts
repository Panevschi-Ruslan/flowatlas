/**
 * The project graph as it was at a commit.
 *
 * The same reading `flowatlas build` does — the same `flowatlas extract` in a
 * process of its own, the same linker — pointed at a detached worktree instead
 * of the working tree, and told to put its output somewhere temporary so
 * nothing is written into anybody's repository.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  parseRepoGraph,
  type FlowatlasConfig,
  type LoadedConfig,
  type ProjectGraph,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import {
  linkGraphs,
  writeGraphDb,
  type DiffSource,
  type DiffWarning,
  type LinkReport,
} from '@flowatlas/linker';
import { EXTRACTORS } from '../build/extractor.js';
import { cannotRun } from '../exit.js';
import { VERSION } from '../version.js';
import { GraphCache } from './graph-cache.js';
import { isGitRepo, pruneWorktrees, resolveSha, withWorktree, type NodeModules } from './worktree.js';
import { ownBin } from '../own-path.js';

const run = promisify(execFile);

const binPath = (): string => ownBin(import.meta.url);

export interface BuildAtRefOptions {
  /** Repositories to read at this ref. Every other one comes from `inherit`. */
  services?: readonly string[];
  /** Graphs for the repositories this side does not read itself. */
  inherit?: Readonly<Record<string, RepoGraph>>;
  /** How those inherited repositories were read, so both sides say the same. */
  inheritSources?: Readonly<Record<string, DiffSource>>;
  /** Leave the detached worktrees on disk, for somebody debugging a reading. */
  keepWorktrees?: boolean;
  /** Where worktree output, temporary configurations and the database go. */
  workDir: string;
  /** Which side this is, so two of them do not share a directory. */
  side: 'base' | 'head';
  /** False to read every commit again rather than believing the cache. */
  cache?: boolean;
  concurrency?: number;
  /** Fixed timestamp, so two runs over one input produce one document. */
  builtAt?: string;
  /** Where `<output>/cache/<sha>/` lives. Absent means do not cache at all. */
  cacheDir?: string;
}

export interface BuildAtRefResult {
  graph: ProjectGraph;
  report: LinkReport;
  /** Each repository's own graph, so the other side can reuse the ones it shares. */
  repoGraphs: Record<string, RepoGraph>;
  dbPath: string;
  sources: Record<string, DiffSource>;
  warnings: DiffWarning[];
  /** Detached checkouts left on disk, when `--keep-worktrees` asked for them. */
  worktrees: string[];
  ms: number;
}

/** Runs a handful of readings at a time, keeping the pool full. */
const inPools = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), Math.max(items.length, 1)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * The configuration a single reading sees, with every path spelled out.
 *
 * A worktree is somewhere else entirely, so a configuration full of paths
 * relative to the project root would name nothing. Only the repository being
 * read is redirected; the rest keep their real paths so the service names, the
 * shared packages and the adapter settings are the project's own.
 */
const configFor = (
  loaded: LoadedConfig,
  service: ServiceConfig,
  readFrom: string,
): FlowatlasConfig => ({
  ...loaded.config,
  services: loaded.config.services.map((entry) => ({
    ...entry,
    repo: entry.name === service.name ? readFrom : loaded.repoDir(entry),
  })),
});

interface ReadOptions {
  loaded: LoadedConfig;
  service: ServiceConfig;
  readFrom: string;
  workDir: string;
}

/**
 * One repository, read in a process of its own, writing nowhere near itself.
 *
 * `--out` is what makes the second half true: `flowatlas extract` would otherwise
 * put its graph in `<repo>/.flowatlas`, which for a working-tree read means
 * writing into somebody's repository to answer a question about it.
 */
const readRepo = async (options: ReadOptions): Promise<RepoGraph> => {
  const { service, readFrom, workDir } = options;
  mkdirSync(workDir, { recursive: true });
  const configPath = join(workDir, 'flowatlas.config.json');
  writeFileSync(
    configPath,
    `${JSON.stringify(configFor(options.loaded, service, readFrom), null, 2)}\n`,
    'utf8',
  );
  const out = join(workDir, 'out');
  await run(process.execPath, [binPath(), 'extract', readFrom, '--config', configPath, '--out', out], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseRepoGraph(JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8')));
};

/**
 * Why a repository could not be read, in words rather than in a command line.
 *
 * The same reasoning as the build's: a child that fails rejects with the
 * command that was run, and what went wrong is on its stderr.
 */
const reasonOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const { stderr } = error as { stderr?: unknown };
  const said = typeof stderr === 'string' ? stderr.trim() : '';
  if (said === '') return message;
  return said.split('\n').filter((line) => line.trim() !== '').slice(-4).join('\n');
};

interface OneSide {
  service: string;
  graph?: RepoGraph;
  source: DiffSource;
  warnings: DiffWarning[];
  /** Where the detached checkout was left, when `--keep-worktrees` asked. */
  worktree?: string;
}

const tree = (nodeModules: NodeModules = 'present'): DiffSource => ({
  sha: null,
  ref: null,
  cached: false,
  nodeModules,
});

/**
 * One repository on one side: from the cache, from a worktree, or from the tree.
 *
 * A ref that does not exist in this repository — a release branch cut in one
 * service and not another — is not a failure. The repository is read as it
 * stands and the report says the service was assumed unchanged, which is a
 * claim a reviewer can check rather than a silence they cannot.
 */
const readSide = async (
  loaded: LoadedConfig,
  service: ServiceConfig,
  ref: string | null,
  options: BuildAtRefOptions,
): Promise<OneSide> => {
  const repoDir = loaded.repoDir(service);
  const workDir = join(options.workDir, options.side, service.name);
  const warnings: DiffWarning[] = [];

  const fromTree = async (): Promise<OneSide> => ({
    service: service.name,
    graph: await readRepo({ loaded, service, readFrom: repoDir, workDir }),
    source: tree(),
    warnings,
  });

  if (ref === null) return fromTree();

  if (!(await isGitRepo(repoDir))) {
    warnings.push({
      reason: 'not-a-git-repo',
      service: service.name,
      message: `${service.name}: ${service.repo} is not a git repository, so it was read as it stands and assumed unchanged`,
      hint: 'Point the service at a repository root, or narrow the run with --service.',
    });
    return fromTree();
  }

  const sha = await resolveSha(repoDir, ref);
  if (sha === null) {
    warnings.push({
      reason: 'ref-not-found',
      service: service.name,
      message: `${service.name}: ref ${ref} not found, so it was read as it stands and assumed unchanged`,
      hint: 'Pass --service, or use a ref that exists in every repository.',
    });
    return fromTree();
  }

  const cache = options.cacheDir === undefined ? null : new GraphCache(options.cacheDir);
  if (cache !== null && options.cache !== false) {
    const hit = cache.get(sha, service.name, service.repo);
    if (hit !== null) {
      return {
        service: service.name,
        graph: hit.graph,
        source: { sha, ref, cached: true, nodeModules: hit.meta.nodeModules },
        warnings,
      };
    }
  }

  await pruneWorktrees(repoDir);
  return withWorktree(
    repoDir,
    sha,
    async (checkout) => {
      if (checkout.nodeModules === 'missing') {
        warnings.push({
          reason: 'node-modules-missing',
          service: service.name,
          message: `${service.name}: no node_modules to resolve against at ${sha.slice(0, 8)}, so imported shapes may be unread`,
          hint: `Run your package manager's install in ${service.repo}.`,
        });
      } else if (checkout.nodeModules === 'linked') {
        warnings.push({
          reason: 'node-modules-linked',
          service: service.name,
          message: `${service.name}: dependencies at ${sha.slice(0, 8)} were resolved against the working tree's installed packages, not that commit's`,
          hint: 'A dependency whose types changed between the two commits will read as the newer one on both sides.',
        });
      }
      const graph = await readRepo({ loaded, service, readFrom: checkout.dir, workDir });
      cache?.put({
        sha,
        service: service.name,
        repo: service.repo,
        ref,
        graph,
        nodeModules: checkout.nodeModules,
      });
      return {
        service: service.name,
        graph,
        source: { sha, ref, cached: false, nodeModules: checkout.nodeModules },
        warnings,
        ...(options.keepWorktrees === true ? { worktree: checkout.dir } : {}),
      };
    },
    { keep: options.keepWorktrees === true },
  );
};

/**
 * The whole project graph at one ref.
 *
 * `services` names what this side reads for itself; anything else is taken from
 * `inherit`, which is how `--service` compares one repository against itself
 * while every other one stays identical on both sides.
 */
export const buildAtRef = async (
  loaded: LoadedConfig,
  ref: string | null,
  options: BuildAtRefOptions,
): Promise<BuildAtRefResult> => {
  const started = Date.now();
  const wanted =
    options.services === undefined
      ? loaded.config.services
      : loaded.config.services.filter((service) => options.services?.includes(service.name));
  const readable = wanted.filter((service) => EXTRACTORS[service.type] !== undefined);

  const limit = options.concurrency ?? Math.max(cpus().length - 1, 1);
  const sides = await inPools(readable, limit, async (service) => {
    try {
      return await readSide(loaded, service, ref, options);
    } catch (error) {
      throw cannotRun(
        `could not read ${service.name} at ${ref ?? 'the working tree'}`,
        reasonOf(error).split('\n'),
      );
    }
  });

  const repoGraphs: Record<string, RepoGraph> = { ...options.inherit };
  const sources: Record<string, DiffSource> = {};
  const warnings: DiffWarning[] = [];
  for (const service of loaded.config.services) {
    const inherited = options.inherit?.[service.name];
    if (inherited !== undefined) {
      repoGraphs[service.name] = inherited;
      sources[service.name] = options.inheritSources?.[service.name] ?? tree();
    }
  }
  for (const side of sides) {
    if (side.graph !== undefined) repoGraphs[side.service] = side.graph;
    sources[side.service] = side.source;
    warnings.push(...side.warnings);
  }

  const ordered = loaded.config.services.flatMap((service) =>
    repoGraphs[service.name] === undefined ? [] : [repoGraphs[service.name] as RepoGraph],
  );
  const linked = linkGraphs(ordered, loaded.config, {
    ...(options.builtAt === undefined ? {} : { builtAt: options.builtAt }),
  });

  const dbPath = join(options.workDir, `${options.side}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  writeGraphDb(linked.project, linked.report, dbPath, { flowatlasVersion: VERSION });

  return {
    graph: linked.project,
    report: linked.report,
    repoGraphs,
    dbPath,
    sources,
    warnings,
    worktrees: sides.flatMap((side) => (side.worktree === undefined ? [] : [side.worktree])),
    ms: Date.now() - started,
  };
};
