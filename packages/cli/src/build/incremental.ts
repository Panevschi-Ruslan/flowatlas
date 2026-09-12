import type { RepoGraph } from '@flowatlas/core';
import type { BuildCache, FileStamp } from './cache.js';
import { diffRepoFiles } from './cache.js';

/**
 * What an extractor has to offer for a repository to be rebuilt incrementally.
 *
 * Declared here rather than in the core because the core is not this ticket's
 * to touch and an extractor must never depend on the command line. TypeScript
 * matches it structurally, so `@flowatlas/extractor-nestjs` satisfies it by
 * exporting the four functions and importing nothing. Moving it into the core
 * is a one-line follow-up for whoever next touches that package.
 */
export interface IncrementalExtractor<Ctx> {
  extractFull(ctx: Ctx): Promise<RepoGraph>;
  extractFiles(ctx: Ctx, files: readonly string[]): Promise<PartialExtract>;
  dependentsOf(ctx: Ctx, files: readonly string[]): string[];
  globalFiles(ctx: Ctx): string[];
}

/** What a scoped extraction produced, and how much of the repository it covers. */
export interface PartialExtract {
  graph: RepoGraph;
  /**
   * `repository` when the extractor re-derived the whole repository from what
   * it had already parsed, which is what the NestJS extractor does. A list of
   * files when it produced only the fragment those files own, which is what an
   * extractor whose passes are cheaply separable may do; that fragment goes
   * through `spliceRepoGraph` before it becomes a graph.
   */
  covers: 'repository' | readonly string[];
}

export type RebuildMode = 'full' | 'partial' | 'skip';

export interface ServicePlan {
  mode: RebuildMode;
  /** Files to re-read, set for a partial rebuild. */
  files?: string[];
  /** One phrase saying why, printed in the summary and in `--timing`. */
  reason: string;
}

export type RebuildPlan = Record<string, ServicePlan>;

/**
 * What planning needs to know about one repository.
 *
 * Gathered by the caller so that planning itself reads nothing from disk and
 * can be tested against a table of situations.
 */
export interface RepoSurvey {
  service: string;
  /** Path as written in the configuration; a repository that moved is a new one. */
  repo: string;
  /** Package that reads this repository, or null when none does. */
  extractor: string | null;
  /** Whether that extractor can re-read named files instead of everything. */
  incremental: boolean;
  adapters: string[];
  tsconfigHash: string;
  packageJsonHash: string;
  /** Files whose change affects the whole repository, from the extractor. */
  globalFiles: string[];
  files: Record<string, FileStamp>;
  graphPath: string;
  /** Hash of the graph on disk, or null when there is none to reuse. */
  graphHash: string | null;
}

export interface PlanOptions {
  cache: BuildCache | null;
  /** Names given to `--service`; every other repository comes from the cache. */
  services?: readonly string[];
  noCache?: boolean;
  /**
   * Share of a repository's files above which a re-read beats a splice.
   *
   * A formatter that rewrites forty files in one save is cheaper to answer with
   * one full read than with forty scoped ones.
   */
  fullThreshold?: number;
}

const DEFAULT_FULL_THRESHOLD = 0.25;

const full = (reason: string): ServicePlan => ({ mode: 'full', reason });
const skip = (reason: string): ServicePlan => ({ mode: 'skip', reason });

/** Files that import any of `files`, one level of reverse imports. */
const dependentsFrom = (
  files: Record<string, FileStamp>,
  touched: ReadonlySet<string>,
): string[] => {
  const out: string[] = [];
  for (const [file, stamp] of Object.entries(files)) {
    if (touched.has(file)) continue;
    if (stamp.deps.some((dep) => touched.has(dep))) out.push(file);
  }
  return out;
};

/**
 * Decides what each repository needs, before anything is read.
 *
 * Whole-cache invalidation has already happened by the time this runs: a cache
 * that cannot be trusted arrives here as null and every repository comes back
 * `full`. What is left is the per-repository question, and the answer is
 * deliberately blunt. Anything that could change how the whole repository is
 * read, from its tsconfig to a file declaring a module, is a full re-read; only
 * an ordinary file changing on its own earns a partial one.
 */
export const planRebuild = (
  surveys: readonly RepoSurvey[],
  options: PlanOptions,
): RebuildPlan => {
  const plan: RebuildPlan = {};
  const selected = options.services === undefined ? undefined : new Set(options.services);
  const threshold = options.fullThreshold ?? DEFAULT_FULL_THRESHOLD;

  for (const survey of [...surveys].sort((a, b) => (a.service < b.service ? -1 : 1))) {
    plan[survey.service] = planOne(survey, options, selected, threshold);
  }
  return plan;
};

const planOne = (
  survey: RepoSurvey,
  options: PlanOptions,
  selected: ReadonlySet<string> | undefined,
  threshold: number,
): ServicePlan => {
  if (survey.extractor === null) return skip('no extractor');
  if (selected !== undefined && !selected.has(survey.service)) return skip('not selected');
  if (options.noCache === true) return full('cache ignored');
  if (options.cache === null) return full('no cache');

  const entry = options.cache.repos[survey.service];
  if (entry === undefined) return full('not in cache');
  if (entry.repo !== survey.repo) return full('repository moved');
  if (entry.extractor !== survey.extractor) return full('extractor changed');
  if (entry.adapters.join(',') !== survey.adapters.join(',')) return full('adapters changed');
  if (entry.tsconfigHash !== survey.tsconfigHash) return full('tsconfig changed');
  if (entry.packageJsonHash !== survey.packageJsonHash) return full('package.json changed');
  if (survey.graphHash === null) return full(`no graph at ${survey.graphPath}`);
  if (survey.graphHash !== entry.graphHash) return full('graph changed outside the build');

  const diff = diffRepoFiles(entry, survey.files);
  const touched = [...diff.added, ...diff.changed, ...diff.removed].sort();
  if (touched.length === 0) return skip('0 files changed');

  const global = new Set([...entry.globalFiles, ...survey.globalFiles]);
  const offender = touched.find((file) => global.has(file));
  if (offender !== undefined) return full(`global file ${offender}`);

  if (!survey.incremental) return full('extractor not incremental');

  const total = Object.keys(entry.files).length;
  if (total > 0 && touched.length > total * threshold) {
    return full(`${touched.length} of ${total} files changed`);
  }

  const set = new Set(touched);
  const files = [...new Set([...touched, ...dependentsFrom(entry.files, set)])].sort();
  return { mode: 'partial', files, reason: `${touched.length} files changed` };
};
