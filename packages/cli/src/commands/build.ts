import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  DEFAULT_OUTPUT,
  FlowatlasError,
  loadConfig,
  parseRepoGraph,
  readPackageJson,
  sitesIn,
  wasMissed,
  SCHEMA_VERSION,
  type FlowatlasConfig,
  type RepoGraph,
  type ServiceConfig,
  type Unresolved,
} from '@flowatlas/core';
import { findTsconfig, listRepoSources } from '@flowatlas/extractor-nestjs';
import { linkGraphs, writeGraphDb, type LinkResult, type ServiceReport } from '@flowatlas/linker';
import type { Command } from 'commander';
import {
  cachePathFor,
  emptyCache,
  hashConfig,
  hashFile,
  hashText,
  loadBuildCache,
  saveBuildCache,
  stampFiles,
  temporaryFor,
  type BuildCache,
  type CacheExpectations,
  type CacheProblem,
  type FileStamp,
  type RepoCache,
} from '../build/cache.js';
import { adapterNames, createRegistry, EXTRACTORS, isFrontend } from '../build/extractor.js';
import { noReaderNote } from '../stacks.js';
import {
  planRebuild,
  type RebuildPlan,
  type RepoSurvey,
  type ServicePlan,
} from '../build/incremental.js';
import { isIncremental, type ServiceSession } from '../build/session.js';
import { spliceRepoGraph } from '../build/splice.js';
import { EXIT } from '../exit.js';
import { BUILD_STAMP, VERSION } from '../version.js';
import { ownBin } from '../own-path.js';

const run = promisify(execFile);

const binPath = (): string => ownBin(import.meta.url);

/** Where a repository's own graph lives, whoever wrote it. */
export const serviceGraphPath = (repoDir: string): string =>
  join(repoDir, DEFAULT_OUTPUT, 'graph.json');

export interface BuildOptions {
  config?: string;
  out?: string;
  concurrency?: string | number;
  json?: boolean;
  /** Leave the browsers out of this build, when only the servers changed. */
  skipFrontend?: boolean;
  print?: (message: string) => void;
  /** Fixed timestamp, for reproducible output. */
  builtAt?: string;
  /** Commander sets this to false for `--no-cache`. */
  cache?: boolean;
  /** Names given to `--service`; every other repository comes from the cache. */
  service?: string[];
  timing?: boolean;
  /** Repositories already parsed, when a watch is driving the build. */
  sessions?: ReadonlyMap<string, ServiceSession>;
}

/** How long each phase of one build took, in milliseconds. */
export interface BuildTiming {
  hash: number;
  extract: number;
  link: number;
  write: number;
  total: number;
  /** `<service>:<file>` for every file re-read, so a slow rebuild names itself. */
  files: string[];
}

export interface BuildResult extends LinkResult {
  outputDir: string;
  graphPath: string;
  dbPath: string;
  reportPath: string;
  cachePath: string;
  /** True when at least one repository could not be read. */
  failed: boolean;
  plan: RebuildPlan;
  timing: BuildTiming;
  /** Why the cache was thrown away, when it was. */
  cacheProblem?: CacheProblem;
}

/** Runs a handful of jobs at a time, keeping the pool full. */
const inPools = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
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

/** What only the extraction knows about a repository's files. */
type FileFacts = Pick<RepoCache, 'files' | 'globalFiles'>;

interface Extracted {
  service: ServiceConfig;
  graph?: RepoGraph;
  report: ServiceReport;
  /** File hashes, imports and global files, for the next build to compare against. */
  facts?: FileFacts;
}

/**
 * Something the build was told to reuse is not there.
 *
 * Its own code because it is the one failure a caller can fix by running the
 * build differently, which is why it leaves exit code 1 rather than 2.
 */
export class BuildInputError extends FlowatlasError {
  constructor(message: string, hint?: string) {
    super('build-input', message, hint);
  }
}

/**
 * What the installed tool would write today.
 *
 * The `@flowatlas/*` packages are released together, so one version answers for
 * all of them; a cache written by a different one is not partly trusted,
 * because an extractor changing what it finds does not need a schema bump.
 *
 * `BUILD_STAMP` rather than `VERSION`, so that a rebuild of the tool itself also
 * counts as a different one. Within a release the version never moves, and a
 * cache written before a change to what the tool reads would otherwise be
 * served back afterwards, unchanged and wrong.
 */
const cacheExpectations = (config: FlowatlasConfig): CacheExpectations => {
  const extractors: Record<string, string> = {};
  for (const service of config.services) {
    const name = EXTRACTORS[service.type];
    if (name !== undefined) extractors[name] = BUILD_STAMP;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    flowatlasVersion: BUILD_STAMP,
    extractors,
    configHash: hashConfig(config),
  };
};

interface SurveyOptions {
  service: ServiceConfig;
  repoDir: string;
  config: FlowatlasConfig;
  previous?: RepoCache;
  session?: ServiceSession;
  trustTimestamps?: boolean;
}

/** Everything planning needs to know about one repository, read from disk. */
const surveyService = (options: SurveyOptions): RepoSurvey => {
  const { service, repoDir, config, previous, session } = options;
  const extractor = EXTRACTORS[service.type] ?? null;
  const tsconfig = findTsconfig(repoDir, service.tsconfig);
  const graphPath = serviceGraphPath(repoDir);
  // Listed from disk even when the repository is already open: a file created
  // since it was opened is exactly the change the survey must not miss.
  const files = listRepoSources(repoDir);

  return {
    service: service.name,
    repo: service.repo,
    extractor,
    incremental: isIncremental(service.type),
    adapters:
      extractor === null ? [] : adapterNames(createRegistry(), readPackageJson(repoDir) ?? {}, config),
    tsconfigHash: tsconfig === undefined ? hashText('') : hashFile(tsconfig),
    packageJsonHash: hashFile(join(repoDir, 'package.json')),
    globalFiles: session?.globalFiles() ?? [],
    files: stampFiles(repoDir, files, previous?.files, {
      ...(options.trustTimestamps === undefined ? {} : { trustTimestamps: options.trustTimestamps }),
    }),
    graphPath,
    graphHash: existsSync(graphPath) ? hashFile(graphPath) : null,
  };
};

const emptyReport = (service: ServiceConfig, extractor: string | null): ServiceReport => ({
  name: service.name,
  repo: service.repo,
  type: service.type,
  extractor,
  nodes: 0,
  edges: 0,
  types: 0,
  unresolved: 0,
  durationMs: 0,
});

/**
 * What one repository came to, as the summary and the cache both count it.
 *
 * `unresolved` counts the rows that say something was not read. Rows at level
 * `nothing` are left out: they stand for places where no edge exists to draw,
 * so a repository full of them is not a repository read badly, and a number
 * that mixed the two would say it was.
 */
const countsOf = (graph: RepoGraph): RepoCache['counts'] => ({
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  types: Object.keys(graph.types).length,
  unresolved: graph.unresolved.filter(wasMissed).length,
});

const reportOf = (
  service: ServiceConfig,
  extractor: string | null,
  graph: RepoGraph,
  durationMs: number,
): ServiceReport => ({
  ...emptyReport(service, extractor),
  ...countsOf(graph),
  durationMs,
});

const readGraph = async (path: string): Promise<RepoGraph> =>
  parseRepoGraph(JSON.parse(await readFile(path, 'utf8')));

/**
 * Puts a graph through the schema, the way one read back from disk arrives.
 *
 * A graph built in this process carries its keys in the order the passes
 * happened to fill them; one that has been through `graph.json` carries them in
 * the order the schema declares. Both describe the same graph, but only one of
 * them is what `project-graph.json` must contain, and it has to be the same one
 * whether the repository was read in a child process or in this one.
 */
const normalise = (graph: RepoGraph): RepoGraph =>
  parseRepoGraph(JSON.parse(JSON.stringify(graph)));

/**
 * Reads one repository, in a process of its own.
 *
 * A whole type-checked program is held in memory while a repository is read, so
 * five of them in one process is five programs in one heap. Separate processes
 * also mean a repository that cannot be read fails alone. A watch pays that
 * price once and then keeps the program, which is what `sessions` is for.
 */
const extractApart = async (repoDir: string, configPath: string): Promise<RepoGraph> => {
  const out = join(repoDir, DEFAULT_OUTPUT);
  await run(process.execPath, [binPath(), 'extract', repoDir, '--config', configPath, '--out', out], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return readGraph(serviceGraphPath(repoDir));
};

/**
 * Why a repository could not be read, in words rather than in a command line.
 *
 * A child process that fails rejects with `Command failed: node … extract …`,
 * which names what was run and nothing about what went wrong. What went wrong
 * is on its stderr, and that is the only part worth reporting.
 */
const reasonOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const { stderr, code, signal } = error as { stderr?: unknown; code?: unknown; signal?: unknown };
  const said = typeof stderr === 'string' ? stderr.trim() : '';
  // Killed rather than failed: nothing was said because nothing got the chance.
  // The signal is then the only fact there is, and it is the one worth having.
  const how = typeof signal === 'string' && signal !== '' ? `killed by ${signal}` : `exit ${String(code ?? '?')}`;
  if (said === '') return `${how}: ${message}`;
  return `${how}\n${said.split('\n').filter((line) => line.trim() !== '').slice(-6).join('\n')}`;
};

/** The single entry a lone `flowatlas extract` leaves behind for the build. */
const readRepoFacts = (path: string, name: string): FileFacts | undefined => {
  const loaded = loadBuildCache(path);
  if (loaded === null || 'problem' in loaded) return undefined;
  const entry = loaded.cache.repos[name] ?? Object.values(loaded.cache.repos)[0];
  return entry === undefined ? undefined : { files: entry.files, globalFiles: entry.globalFiles };
};

interface ExtractOneOptions {
  service: ServiceConfig;
  repoDir: string;
  configPath: string;
  plan: ServicePlan;
  session?: ServiceSession;
  previous?: RepoCache;
  /** What the survey found on disk, before anything was read. */
  stamps?: Record<string, FileStamp>;
  /** Leave the browsers out, when only the servers changed. */
  skipFrontend?: boolean;
}

/** Reads one repository, or reuses what the last build left of it. */
const extractOne = async (options: ExtractOneOptions): Promise<Extracted> => {
  const { service, repoDir, plan, session, previous } = options;
  const extractor = EXTRACTORS[service.type] ?? null;
  const base = emptyReport(service, extractor);

  // Asked to leave the browsers out. It reads like a service with no extractor,
  // since that is what it is for this run, but it says which is which so a
  // report is never mistaken for a missing reader.
  if (options.skipFrontend === true && isFrontend(service.type)) {
    return {
      service,
      report: { ...base, skipped: 'no-extractor', error: 'left out by --skip-frontend' },
    };
  }

  // A repository with no reader contributes nothing, and the graph is smaller
  // than the project by exactly that much. Naming the framework turns a line
  // nobody can act on into one that says what would have to exist.
  if (extractor === null) {
    const note = noReaderNote(readPackageJson(repoDir));
    return {
      service,
      report: { ...base, skipped: 'no-extractor', ...(note === undefined ? {} : { error: note }) },
    };
  }

  if (plan.mode === 'skip') {
    const graph = await readGraph(serviceGraphPath(repoDir)).catch(() => {
      throw new BuildInputError(
        `missing graph for ${service.name} (${serviceGraphPath(repoDir)})`,
        'Run flowatlas build without --service first.',
      );
    });
    return {
      service,
      graph,
      report: { ...base, ...countsOf(graph) },
      ...(previous === undefined
        ? {}
        : { facts: { files: previous.files, globalFiles: previous.globalFiles } }),
    };
  }

  const started = Date.now();
  try {
    const graph =
      session === undefined
        ? await extractApart(repoDir, options.configPath)
        : normalise(await extractWarm(session, plan, repoDir));
    if (session !== undefined) await writeJson(serviceGraphPath(repoDir), graph);
    const facts =
      session === undefined
        ? readRepoFacts(join(repoDir, DEFAULT_OUTPUT, 'cache.json'), service.name)
        : factsFromSession(session, options.stamps ?? {}, previous);
    return {
      service,
      graph,
      report: reportOf(service, extractor, graph, Date.now() - started),
      ...(facts === undefined ? {} : { facts }),
    };
  } catch (error) {
    if (error instanceof BuildInputError) throw error;
    const text = reasonOf(error);
    return {
      service,
      report: {
        ...base,
        skipped: 'extract-failed',
        error: text.split('\n').slice(-3).join(' ').slice(0, 300),
        durationMs: Date.now() - started,
      },
    };
  }
};

/**
 * Reads a repository that is already open.
 *
 * A partial read hands the extractor the files that changed. What comes back
 * may be the whole repository, when the extractor re-derived it from what it
 * had parsed, or the fragment those files own, which is spliced onto the graph
 * the last build left.
 */
const extractWarm = async (
  session: ServiceSession,
  plan: ServicePlan,
  repoDir: string,
): Promise<RepoGraph> => {
  if (plan.mode === 'full') return session.extractFull();
  try {
    const { graph, covers } = await session.extractFiles(plan.files ?? []);
    if (covers === 'repository') return graph;
    const previous = await readGraph(serviceGraphPath(repoDir));
    return spliceRepoGraph(previous, [...covers], graph);
  } catch {
    // Reading part of a repository is an optimisation, so a part that will not
    // fit back together costs time rather than correctness. A full read that
    // fails too is a real failure and is reported as one.
    return session.extractFull();
  }
};

/**
 * The files an open repository holds, with what each of them imports.
 *
 * Stamped by the survey, which ran before the repository was read, rather than
 * again once it had been. A save that lands while a repository is being read is
 * not in the graph the read produced, so a stamp taken afterwards records it as
 * read and the next rebuild answers `0 files changed`: the save is lost, with
 * the watch quiet and sure it is up to date. One save in five did that, of
 * those that landed inside a rebuild. Stamping beforehand can only cost a file
 * being read a second time, which is the harmless direction to be wrong in.
 *
 * A file the survey did not see — one the open program holds and the source
 * listing does not — is stamped here, because there is nothing earlier to use.
 */
const factsFromSession = (
  session: ServiceSession,
  stamps: Record<string, FileStamp>,
  previous?: RepoCache,
): FileFacts => {
  const imports = session.imports();
  const held = [...session.files()].sort();
  const unseen = held.filter((file) => stamps[file] === undefined);
  const late = unseen.length === 0 ? {} : stampFiles(session.repoDir, unseen, previous?.files, {});
  const files: Record<string, FileStamp> = {};
  for (const file of held) {
    const stamp = stamps[file] ?? late[file];
    if (stamp !== undefined) files[file] = { ...stamp, deps: imports[file] ?? [] };
  }
  return { files, globalFiles: session.globalFiles() };
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = temporaryFor(path);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
};

/** Long enough that nothing still being written could look this old. */
const ABANDONED_MS = 10 * 60 * 1000;

/**
 * A run cut short leaves half-written files behind; the next one clears them.
 *
 * Only the ones nothing could still be writing. Clearing every temporary in
 * sight used to delete a file another run was about to rename into place, which
 * turned two builds over one repository into one failure.
 */
const clearTemporaries = (outputDir: string): void => {
  let entries: string[];
  try {
    entries = readdirSync(outputDir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith('.tmp') && !entry.endsWith('.building')) continue;
    const path = join(outputDir, entry);
    try {
      if (now - statSync(path).mtimeMs < ABANDONED_MS) continue;
    } catch {
      continue;
    }
    rmSync(path, { force: true, recursive: true });
  }
};

/**
 * Reads every repository and joins them.
 *
 * The joined graph is the canonical artefact; the database beside it is a
 * projection of the same thing, rebuilt each time so the two cannot drift. What
 * is read is decided first, from file hashes recorded last time: a repository
 * nothing touched is not read at all, and linking runs in full regardless,
 * because linking is cheap and a partial link would be a second way for the
 * graph to be wrong.
 */
export const buildProject = async (options: BuildOptions = {}): Promise<BuildResult> => {
  const startedAt = Date.now();
  const loaded = loadConfig(options.config ?? process.cwd());

  const known = new Set(loaded.config.services.map((service) => service.name));
  const unknown = (options.service ?? []).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new BuildInputError(
      `no service named ${unknown.map((name) => JSON.stringify(name)).join(', ')}`,
      `Known services: ${[...known].sort().join(', ')}.`,
    );
  }

  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  await mkdir(outputDir, { recursive: true });
  clearTemporaries(outputDir);

  const expected = cacheExpectations(loaded.config);
  const cachePath = cachePathFor(outputDir);
  const noCache = options.cache === false;
  const found = noCache ? null : loadBuildCache(cachePath, expected);
  const cacheProblem = found !== null && 'problem' in found ? found.problem : undefined;
  const cache = found !== null && 'cache' in found ? found.cache : null;

  const surveys = loaded.config.services.map((service) => {
    const previous = cache?.repos[service.name];
    const session = options.sessions?.get(service.name);
    return surveyService({
      service,
      repoDir: loaded.repoDir(service),
      config: loaded.config,
      ...(previous === undefined ? {} : { previous }),
      ...(session === undefined ? {} : { session }),
      ...(options.sessions === undefined ? {} : { trustTimestamps: true }),
    });
  });
  const plan = planRebuild(surveys, {
    cache,
    noCache,
    ...(options.service === undefined || options.service.length === 0
      ? {}
      : { services: options.service }),
  });
  const hashed = Date.now();

  const limit =
    options.concurrency === undefined
      ? Math.max(cpus().length - 1, 1)
      : Math.max(Number(options.concurrency), 1);

  const extracted = await inPools(loaded.config.services, limit, (service) => {
    const previous = cache?.repos[service.name];
    const session = options.sessions?.get(service.name);
    const surveyed = surveys.find((entry) => entry.service === service.name);
    return extractOne({
      service,
      repoDir: loaded.repoDir(service),
      configPath: loaded.configPath,
      plan: plan[service.name] ?? { mode: 'full', reason: 'not planned' },
      ...(options.skipFrontend === undefined ? {} : { skipFrontend: options.skipFrontend }),
      ...(session === undefined ? {} : { session }),
      ...(previous === undefined ? {} : { previous }),
      ...(surveyed === undefined ? {} : { stamps: surveyed.files }),
    });
  });
  const extractedAt = Date.now();

  const graphs = extracted.flatMap((item) => (item.graph === undefined ? [] : [item.graph]));
  const result = linkGraphs(graphs, loaded.config, {
    ...(options.builtAt === undefined ? {} : { builtAt: options.builtAt }),
    services: extracted.map((item) => item.report),
  });
  const linkedAt = Date.now();

  const graphPath = join(outputDir, 'project-graph.json');
  const dbPath = join(outputDir, 'graph.db');
  const reportPath = join(outputDir, 'link-report.json');

  await writeJson(graphPath, result.project);
  await writeJson(reportPath, result.report);
  writeGraphDb(result.project, result.report, dbPath, { flowatlasVersion: VERSION });

  // Written even when it was ignored: `--no-cache` means read everything now,
  // not stay slow next time.
  saveBuildCache(cachePath, nextCache(expected, result.project.builtAt, surveys, extracted));
  const done = Date.now();

  return {
    ...result,
    outputDir,
    graphPath,
    dbPath,
    reportPath,
    cachePath,
    failed: extracted.some((item) => item.report.skipped === 'extract-failed'),
    plan,
    timing: {
      hash: hashed - startedAt,
      extract: extractedAt - hashed,
      link: linkedAt - extractedAt,
      write: done - linkedAt,
      total: done - startedAt,
      files: filesRead(plan),
    },
    ...(cacheProblem === undefined ? {} : { cacheProblem }),
  };
};

const filesRead = (plan: RebuildPlan): string[] =>
  Object.entries(plan)
    .flatMap(([name, entry]) => (entry.files ?? []).map((file) => `${name}:${file}`))
    .sort();

/** What the next build will compare against, one entry per repository read. */
const nextCache = (
  expected: CacheExpectations,
  builtAt: string,
  surveys: readonly RepoSurvey[],
  extracted: readonly Extracted[],
): BuildCache => {
  const cache = emptyCache(expected, builtAt);
  for (const item of extracted) {
    const survey = surveys.find((entry) => entry.service === item.service.name);
    if (survey === undefined || survey.extractor === null || item.graph === undefined) continue;
    const carried = item.facts;
    cache.repos[item.service.name] = {
      repo: survey.repo,
      extractor: survey.extractor,
      adapters: survey.adapters,
      tsconfigHash: survey.tsconfigHash,
      packageJsonHash: survey.packageJsonHash,
      globalFiles: carried?.globalFiles ?? survey.globalFiles,
      files: carried?.files ?? survey.files,
      graphPath: survey.graphPath,
      graphHash: hashFile(survey.graphPath),
      counts: countsOf(item.graph),
    };
  }
  return cache;
};

/**
 * What the unresolved rows came to, in one line.
 *
 * Three numbers, and two of them are never added together. Rows and places
 * differ wherever a reason was folded, and both are worth saying: one is how
 * long the list is, the other is what it covers. A place where nothing joins is
 * neither — a template binding that assigns to a field has no other end, in
 * this project or any other — so it is said last, in its own clause, and only
 * when there is one.
 */
export const unresolvedLine = (rows: readonly Unresolved[], missed: number): string => {
  const sites = sitesIn(rows.filter(wasMissed));
  const nothing = rows.filter((row) => !wasMissed(row));
  const nothingSites = sitesIn(nothing);
  return (
    `unresolved: ${missed}` +
    (sites === missed ? '' : ` rows over ${sites} sites`) +
    (nothing.length === 0
      ? ''
      : `, and ${nothingSites} site${nothingSites === 1 ? '' : 's'} with nothing to join`)
  );
};

/** What the build found, in the order someone reading it would want. */
export const summariseBuild = (result: BuildResult): string[] => {
  const { report } = result;
  const lines: string[] = [];
  if (result.cacheProblem !== undefined) lines.push(`cache-invalid:${result.cacheProblem}`);
  lines.push(
    `built ${report.totals.nodes} nodes, ${report.totals.edges} edges from ${report.services.length} service(s)`,
  );
  for (const service of report.services) {
    const entry = result.plan[service.name];
    const status =
      service.skipped !== undefined
        ? `skipped (${service.skipped}${service.error === undefined ? '' : `: ${service.error}`})`
        : entry?.mode === 'skip'
          ? `cached (${entry.reason})`
          : `${service.nodes} nodes, ${service.unresolved} unresolved, ${service.durationMs}ms`;
    lines.push(`  ${service.name.padEnd(14)} ${status}`);
  }
  /**
   * Repositories whose imports the checker could not resolve.
   *
   * Reading a repository whose dependencies are not installed succeeds: the
   * files parse, the classes are found, and everything their types were going
   * to say is missing. One fixture lost 37% of its edges that way and the
   * summary still read like a clean build, which is the likeliest mistake
   * anyone makes on a first run and the one this said nothing about.
   */
  const unread = new Map<string, number>();
  for (const row of result.project.unresolved) {
    if (row.reason !== 'type-unresolved') continue;
    const where = row.service ?? '';
    unread.set(where, (unread.get(where) ?? 0) + (row.sites ?? 1));
  }
  if (unread.size > 0) {
    const named = [...unread.entries()].map(([name, count]) => `${name} (${count})`).join(', ');
    lines.push(
      `imports the checker could not resolve: ${named}` +
        ' — install the dependencies of those repositories, or fix their tsconfig paths;' +
        ' what a missing type was going to say is missing from this graph',
    );
  }

  const { httpOut, ui, channels, routes } = report;
  lines.push(
    `calls out: ${httpOut.total} total, ${httpOut.linked} linked, ${httpOut.byMarker} by annotation, ` +
      `${httpOut.noRoute} no route, ${httpOut.unknownEnv} unknown setting, ${httpOut.ambiguous} ambiguous, ` +
      `${httpOut.external} third party, ${httpOut.dynamic} dynamic`,
  );
  const reasons = Object.entries(ui.byReason)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  lines.push(
    `ui calls: ${ui.total} total, ${ui.resolved} joined to a route, ${ui.unresolved} not` +
      (reasons === '' ? '' : ` (${reasons})`),
  );
  lines.push(
    `channels: ${channels.total} total, ${channels.linked} joined, ${channels.noConsumers.length} with no handler, ${channels.noProducers.length} with no publisher`,
  );
  lines.push(
    `routes: ${routes.total} total, ${routes.called} reached, ${routes.uncalled.length} never called` +
      (routes.duplicated.length === 0 ? '' : `, ${routes.duplicated.length} claimed by two handlers`),
  );
  lines.push(`types: ${report.types.total} (${report.types.sharedPackage} from shared packages)`);
  // Rows and places differ wherever a reason was folded, and both are worth
  // saying: one is how long the list is, the other is what it covers.
  lines.push(unresolvedLine(result.project.unresolved, report.totals.unresolved));
  return lines;
};

/**
 * One line saying what was read and what was not.
 *
 * `previous` is the unresolved count of the last rebuild in this session, so a
 * watch says which edit started leaving things unresolved rather than only how
 * many there are.
 */
export const summariseRebuild = (result: BuildResult, previous?: number): string => {
  const read: string[] = [];
  const cached: string[] = [];
  for (const [name, entry] of Object.entries(result.plan).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (entry.mode === 'skip') cached.push(name);
    else if (entry.mode === 'full') read.push(`${name}: full (${entry.reason})`);
    else read.push(`${name}: ${entry.files?.length ?? 0} files`);
  }
  if (read.length === 0) read.push('nothing changed');
  else if (cached.length > 0) read.push(cached.length === 1 ? `${cached[0]}: cached` : 'others: cached');
  const total = result.report.totals.unresolved;
  const delta = previous === undefined || previous === total ? '' : ` (${signed(total - previous)})`;
  return `rebuilt in ${result.timing.total}ms (${read.join(', ')}) unresolved: ${total}${delta}`;
};

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

export const registerBuild = (program: Command): void => {
  program
    .command('build')
    .description('read every repository in the configuration and join them into one graph')
    .argument('[dir]', 'directory to find the configuration in (default: the working directory)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--out <dir>', 'output directory (default: the configured one)')
    .option('--concurrency <n>', 'how many repositories to read at once')
    .option('--service <name>', 'read only this repository, repeatable', collect, [])
    .option('--no-cache', 'ignore the recorded file hashes and read everything')
    .option('--watch', 'keep reading, rebuilding after every change')
    .option('--timing', 'print how long each phase took, as JSON')
    .option('--skip-frontend', 'leave out the services a frontend extractor reads')
    .option('--json', 'print the report as JSON')
    .action(async (dir: string | undefined, options: BuildOptions & { watch?: boolean }) => {
      const settings: BuildOptions = {
        ...options,
        ...(options.config === undefined && dir !== undefined ? { config: dir } : {}),
      };
      if (options.watch === true) {
        const { watchProject } = await import('../build/watch.js');
        const handle = await watchProject(settings);
        await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
        process.stderr.write('\n');
        await handle.close();
        return;
      }
      let result: BuildResult;
      try {
        result = await buildProject(settings);
      } catch (error) {
        if (!(error instanceof BuildInputError)) throw error;
        process.stderr.write(`${error.message}\n`);
        if (error.hint !== undefined) process.stderr.write(`${error.hint}\n`);
        process.exitCode = EXIT.failed;
        return;
      }
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
      } else {
        process.stderr.write(`${summariseBuild(result).join('\n')}\n`);
        process.stdout.write(`${result.graphPath}\n`);
      }
      if (options.timing === true) {
        process.stderr.write(`${JSON.stringify(result.timing)}\n`);
      }
      if (result.failed) process.exitCode = 2;
    });
};

const collect = (value: string, previous: string[]): string[] => [...previous, value];
