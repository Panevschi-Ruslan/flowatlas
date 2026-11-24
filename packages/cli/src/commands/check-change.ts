/**
 * `flowatlas check-change [--base <ref>]` - what the working tree breaks
 * across repositories, before it is committed (P387).
 *
 * `flowatlas diff` builds two revisions in detached checkouts and writes a
 * document; `what_changed` reads that document, so a session had to run the
 * diff first or not know. This compares the working tree with the graph
 * already built: only the services whose files changed since the build are
 * read again, every other one is the built graph's on both sides, and the
 * answer is `diff`'s - calls and channel ends that lost what they joined, new
 * contract errors, new findings and gaps, the ways in the changed code
 * reaches - with the verdict `what_changed` gives and what could not be
 * checked. With `--base` the other side is that ref, read for the same
 * services, in place of the built graph.
 *
 * The graph server's `check_change` runs this in a process of its own and
 * stops it at a bound, since a build blocks whatever runs it.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, readFreshness, staleOf, type LoadedConfig, type ProjectGraph, type RepoGraph } from '@flowatlas/core';
import { openGraphDb, type DiffSource, type LinkReport } from '@flowatlas/linker';
import { CHECK_CHANGE_SECONDS, checkChangeAnswer, type ChangeCheck, type ChangeChecker, type ChangeCheckInput } from '@flowatlas/mcp';
import { Option, type Command } from 'commander';
import { cannotRun } from '../exit.js';
import { buildAtRef, type BuildAtRefResult } from '../git/build-at-ref.js';
import { ownBin } from '../own-path.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { serviceGraphPath } from './build.js';
import { compareBuilt, DEFAULT_MAX_FLOWS } from './diff.js';
import { sequenceDetailOf } from './flow.js';

export interface CheckChangeOptions {
  config?: string;
  base?: string;
  service?: string[];
  format?: string;
  /** Seconds before the run gives up; the server's bound is its own. */
  timeout?: string;
  /** The comparison itself as JSON (`ChangeCheck`), for the graph server. */
  raw?: boolean;
  maxNodes?: string;
}

/** How the base side is named in the answer when it is the graph already built. */
export const BUILT_SIDE = 'built graph';

/**
 * The built graph as one side of a comparison: the project graph, the link
 * report and each service's own graph as the last build wrote them, and a
 * copy of its database, so the comparison never holds the file a server or a
 * build is using.
 */
export const builtSide = (loaded: LoadedConfig, workDir: string): BuildAtRefResult => {
  const dir = loaded.outputDir;
  const graphPath = join(dir, 'project-graph.json');
  if (!existsSync(graphPath) || !existsSync(join(dir, 'graph.db'))) throw cannotRun(`no graph is built in ${dir}: run flowatlas build first`);
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as ProjectGraph;
  const report = JSON.parse(readFileSync(join(dir, 'link-report.json'), 'utf8')) as LinkReport;
  const freshness = readFreshness(join(dir, 'graph.db'));
  const repoGraphs: Record<string, RepoGraph> = {};
  const sources: Record<string, DiffSource> = {};
  for (const service of loaded.config.services) {
    const path = serviceGraphPath(dir, service.name);
    if (existsSync(path)) repoGraphs[service.name] = JSON.parse(readFileSync(path, 'utf8')) as RepoGraph;
    sources[service.name] = { sha: freshness?.services[service.name]?.commit ?? null, ref: BUILT_SIDE, cached: true, nodeModules: 'present' };
  }
  const dbPath = join(workDir, 'built.db');
  const db = openGraphDb(join(dir, 'graph.db'), { readonly: true });
  try {
    db.copyTo(dbPath);
  } finally {
    db.close();
  }
  return { graph, report, repoGraphs, dbPath, sources, warnings: [], worktrees: [], ms: 0 };
};

const git = (dir: string, args: readonly string[]): string | undefined => {
  try {
    return execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  } catch {
    return undefined;
  }
};

/**
 * The services whose files moved since the build, and what could not be
 * said: a file the build read that changed or went, against the stamps it
 * wrote (P230), or a file git lists as new that the build has no stamp for.
 * A service the build wrote no stamps for is read, and said.
 */
export const changedSinceBuild = (loaded: LoadedConfig): { changed: string[]; unchecked: string[] } => {
  const freshness = readFreshness(join(loaded.outputDir, 'graph.db'));
  const changed: string[] = [];
  const unchecked: string[] = [];
  for (const service of loaded.config.services) {
    const dir = loaded.repoDir(service);
    if (!existsSync(dir)) {
      unchecked.push(`${service.name}: ${service.repo} is not on disk, so it is the built graph's on both sides`);
      continue;
    }
    const known = freshness?.services[service.name];
    if (known === undefined) {
      changed.push(service.name);
      unchecked.push(`${service.name}: the build wrote no stamps for its files, so it was read whole`);
      continue;
    }
    const files = Object.keys(known.files);
    if (staleOf(freshness, files.map((file) => ({ service: service.name, file }))) !== undefined) {
      changed.push(service.name);
      continue;
    }
    const listed = git(dir, ['status', '--porcelain', '--untracked-files=all', '--', '.']);
    if (listed === undefined) continue;
    const prefix = git(dir, ['rev-parse', '--show-prefix'])?.trim() ?? '';
    const added = listed
      .split('\n')
      .filter((line) => line.startsWith('?? '))
      .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
      .map((file) => (prefix !== '' && file.startsWith(prefix) ? file.slice(prefix.length) : file));
    if (added.some((file) => known.files[file] === undefined)) changed.push(service.name);
  }
  return { changed, unchecked };
};

/** The services that differ from `base`: tracked changes against it, or a file git lists as new. */
const changedSinceRef = (loaded: LoadedConfig, base: string): { changed: string[]; unchecked: string[] } => {
  const changed: string[] = [];
  const unchecked: string[] = [];
  for (const service of loaded.config.services) {
    const dir = loaded.repoDir(service);
    if (!existsSync(dir)) {
      unchecked.push(`${service.name}: ${service.repo} is not on disk, so it is the built graph's on both sides`);
      continue;
    }
    const diff = git(dir, ['diff', '--name-only', base, '--', '.']);
    const fresh = git(dir, ['ls-files', '--others', '--exclude-standard', '--', '.']);
    if (diff === undefined) {
      changed.push(service.name);
      unchecked.push(`${service.name}: git could not compare it with ${base}, so it was read at the working tree and at ${base} as far as each goes`);
      continue;
    }
    if (diff.trim() !== '' || (fresh ?? '').trim() !== '') changed.push(service.name);
  }
  return { changed, unchecked };
};

/**
 * The comparison: the services that changed read from the working tree, the
 * other side the built graph (or `base` for the same services), compared as
 * `diff` compares two sides.
 */
export const checkWorkingTree = async (loaded: LoadedConfig, input: Omit<ChangeCheckInput, 'timeoutMs'> & { maxNodes?: number }): Promise<ChangeCheck> => {
  const started = Date.now();
  const known = loaded.config.services.map((service) => service.name);
  const unknown = (input.services ?? []).filter((name) => !known.includes(name));
  if (unknown.length > 0) throw cannotRun(`no service named ${unknown.map((name) => JSON.stringify(name)).join(', ')}; the services are ${known.join(', ')}`);
  const found = input.services !== undefined && input.services.length > 0
    ? { changed: [...input.services], unchecked: [] as string[] }
    : input.base === undefined
      ? changedSinceBuild(loaded)
      : changedSinceRef(loaded, input.base);
  const workDir = mkdtempSync(join(tmpdir(), 'flowatlas-check-change-'));
  try {
    const built = builtSide(loaded, workDir);
    const others = <T>(rows: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rows).filter(([name]) => !found.changed.includes(name)));
    const shared = { workDir, cacheDir: loaded.outputDir };
    const head =
      found.changed.length === 0
        ? built
        : await buildAtRef(loaded, null, { ...shared, side: 'head', services: found.changed, inherit: others(built.repoGraphs), inheritSources: others(built.sources) });
    const base =
      input.base === undefined || found.changed.length === 0
        ? built
        : await buildAtRef(loaded, input.base, { ...shared, side: 'base', services: found.changed, inherit: others(built.repoGraphs), inheritSources: others(built.sources) });
    const report = compareBuilt({
      loaded,
      base,
      head,
      baseRef: input.base ?? BUILT_SIDE,
      headRef: null,
      limits: { maxEntries: 150, maxNodes: input.maxNodes ?? 100, maxFlows: DEFAULT_MAX_FLOWS },
      sequenceDetail: sequenceDetailOf(undefined),
      generatedAt: new Date().toISOString(),
      started,
    });
    return { report, read: found.changed, unchecked: found.unchecked, ms: Date.now() - started };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};

/**
 * The checker the graph server is handed (P387): this command, with
 * `--raw`, in a process of its own, killed at the bound. What it could not
 * finish is an error naming the bound and the services it was reading.
 */
export const changeCheckerFor = (configPath: () => string | undefined): ChangeChecker => async (input) => {
  const config = configPath();
  if (config === undefined) return { error: 'check_change needs the configuration, so it knows each repository; start the server with --config' };
  const args = [ownBin(import.meta.url), 'check-change', '--raw', '--config', config];
  if (input.base !== undefined) args.push('--base', input.base);
  for (const service of input.services ?? []) args.push('--service', service);
  return new Promise((done) => {
    execFile(process.execPath, args, { timeout: input.timeoutMs, maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        const killed = (error as { killed?: boolean }).killed === true;
        done(
          killed
            ? {
                error: `check_change stopped after ${Math.round(input.timeoutMs / 1000)}s, before the changed services were read and compared`,
                unchecked: ['everything: ask again with a larger timeoutSeconds, or name fewer services, or run flowatlas check-change'],
              }
            : { error: String(stderr).trim().split('\n').filter((line) => line !== '').slice(-3).join(' ') || error.message },
        );
        return;
      }
      try {
        done(JSON.parse(stdout) as ChangeCheck);
      } catch (cause) {
        done({ error: `check_change could not read the comparison: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
    });
  });
};

const say = (check: ChangeCheck, maxNodes: number): string => {
  const answer = checkChangeAnswer(check, { maxNodes, detail: 1 }) as Record<string, unknown> & {
    verdict?: string;
    because?: string[];
    compared: string;
    read: string[];
    ms: number;
    vanishedTargets?: Array<{ caller: string; target: string; now: string }>;
    breaks: Array<{ message: string }>;
    newFindings?: Array<{ kind: string; id: string; message?: string }>;
    retest?: Array<{ id: string; label?: string }>;
    left?: string[];
  };
  const lines = [
    `${answer.verdict ?? 'unknown'}: ${answer.compared}`,
    ...(answer.because ?? []).map((reason) => `  - ${reason}`),
    `read again: ${answer.read.length === 0 ? 'nothing changed since the build' : answer.read.join(', ')} (${(answer.ms / 1000).toFixed(1)}s)`,
  ];
  const list = <T>(title: string, rows: readonly T[] | undefined, line: (row: T) => string): void => {
    if (rows === undefined || rows.length === 0) return;
    lines.push(`${title} (${rows.length}):`, ...rows.map((row) => `  ${line(row)}`));
  };
  list('lost what they joined', answer.vanishedTargets, (row) => `${row.caller} -> ${row.target}: ${row.now}`);
  list('new contract errors', answer.breaks, (row) => row.message);
  list('new findings', answer.newFindings, (row) => `${row.kind} ${row.id}${row.message === undefined ? '' : `: ${row.message}`}`);
  list('ways in the change reaches', answer.retest, (row) => row.label ?? row.id);
  list('not checked', answer.left, (row) => row);
  return `${lines.join('\n')}\n`;
};

/** Runs the check and prints it: the comparison (`--raw`), the answer as JSON, or as text. */
export const runCheckChange = async (options: CheckChangeOptions, io: QueryIo = processIo): Promise<ChangeCheck> => {
  const loaded = loadConfig(options.config ?? process.cwd());
  if (options.format !== undefined && options.format !== 'text' && options.format !== 'json') throw cannotRun(`--format must be text or json, not ${JSON.stringify(options.format)}`);
  const maxNodes = options.maxNodes === undefined ? 20 : Number(options.maxNodes);
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw cannotRun(`--max-nodes must be a whole number of at least 1, not ${JSON.stringify(options.maxNodes)}`);
  const seconds = options.timeout === undefined ? undefined : Number(options.timeout);
  if (seconds !== undefined && !(seconds > 0)) throw cannotRun(`--timeout must be a number of seconds, not ${JSON.stringify(options.timeout)}`);
  const deadline =
    seconds === undefined
      ? undefined
      : setTimeout(() => {
          io.err(`flowatlas check-change: stopped after ${seconds}s, before the changed services were read and compared\n`);
          process.exit(2);
        }, seconds * 1000);
  deadline?.unref();
  try {
    const check = await checkWorkingTree(loaded, {
      ...(options.base === undefined ? {} : { base: options.base }),
      ...(options.service === undefined ? {} : { services: options.service }),
    });
    if (options.raw === true) io.out(`${JSON.stringify(check)}\n`);
    else if (options.format === 'json') io.out(`${JSON.stringify(checkChangeAnswer(check, { maxNodes }), null, 2)}\n`);
    else io.out(say(check, maxNodes));
    return check;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
};

export const registerCheckChange = (program: Command): void => {
  program
    .command('check-change')
    .description('what the working tree breaks across repositories, against the built graph (or --base), before it is committed')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--base <ref>', 'compare with this git ref in place of the built graph')
    .option('--service <name...>', 'read only these services again (default: those whose files changed since the build)')
    .option('--format <format>', 'text or json', 'text')
    .option('--max-nodes <n>', 'most rows of each list', '20')
    .option('--timeout <seconds>', `give up after this long (the graph server stops at ${CHECK_CHANGE_SECONDS}s unless asked)`)
    .addOption(new Option('--raw', 'the comparison as JSON, for the graph server').hideHelp())
    .action(async (options: CheckChangeOptions) => {
      await runCheckChange(options);
    });
};
