/**
 * `flowatlas diff <base-ref> [head-ref]` — what a branch does to the whole project.
 *
 * Builds the graph at both revisions without touching the working tree, says
 * which nodes, edges and declarations moved, walks backwards from every one of
 * them to the buttons, bot presses and channel handlers that reach it, re-checks
 * the contracts on both sides, and prints the answer as a document.
 *
 * This is the phase where the graph stops describing and starts deciding: with
 * `--fail-on-contract-break` a pipeline blocks a merge on a boundary this branch
 * broke — and only on the ones it broke.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { checkContracts, type CheckOptions } from '@flowatlas/contracts';
import { loadConfig, SCHEMA_VERSION, type LoadedConfig } from '@flowatlas/core';
import {
  blastRadius,
  diffGraphs,
  DIFF_FORMAT_VERSION,
  graphDiffSchema,
  impactedNodes,
  openGraphDb,
  type BlastRow,
  type DiffReport,
  type DiffSide,
  type DiffWarning,
} from '@flowatlas/linker';
import type { Command } from 'commander';
import { cannotRun, CliError, EXIT } from '../exit.js';
import { buildAtRef, type BuildAtRefResult } from '../git/build-at-ref.js';
import { isDirty } from '../git/worktree.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { classifyContracts, contractBreaks } from '../report/contract-delta.js';
import { renderDiffMarkdown, summariseDiff } from '../report/diff-markdown.js';
import { registerCache } from './cache.js';

export const FORMATS = ['markdown', 'json'] as const;
export type DiffFormat = (typeof FORMATS)[number];

/** The file every run leaves behind, whatever it printed. */
export const DIFF_FILE = 'diff.json';

export interface DiffOptions {
  config?: string;
  /** Repositories to compare. Every other one is the same on both sides. */
  service?: string[];
  format?: string;
  /** Where to write what was printed. The JSON document is always written too. */
  output?: string;
  failOnContractBreak?: boolean;
  maxEntries?: string;
  /** Most changed nodes to walk backwards from. The rest are counted (I9). */
  maxNodes?: string;
  /** Commander sets this to false for `--no-cache`. */
  cache?: boolean;
  keepWorktrees?: boolean;
  concurrency?: string;
  /** Where `diff.json` and `cache/` go. Defaults to the configured output. */
  out?: string;
  /** Fixed timestamp, for output that is the same on two runs. */
  generatedAt?: string;
}

export interface DiffRun {
  report: DiffReport;
  text: string;
  /** Where the complete document was written. */
  file: string;
  exitCode: number;
  /** Services neither ref could be read for, when there were any. */
  unread?: string[];
}

const oneOf = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  flag: string,
): T => {
  if (value === undefined) return fallback;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw cannotRun(`${flag} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`);
  }
  return found;
};

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw cannotRun(`${flag} must be a whole number of at least 1, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

const sideOf = (ref: string | null, built: BuildAtRefResult): DiffSide => ({
  ref,
  services: built.sources,
});

/**
 * Which repositories this run compares.
 *
 * `--service` names one; everything else then uses its head graph on both
 * sides, so the comparison is of that repository and nothing else.
 */
const wantedServices = (loaded: LoadedConfig, names: readonly string[] | undefined): string[] => {
  const known = loaded.config.services.map((service) => service.name);
  if (names === undefined || names.length === 0) return known;
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw cannotRun(`no service named ${unknown.map((name) => JSON.stringify(name)).join(', ')}`, [
      `Known services: ${[...known].sort().join(', ')}.`,
    ]);
  }
  return [...names];
};

/**
 * A note for the case a reviewer is most likely to be caught out by.
 *
 * Naming a head ref while there is uncommitted work means the work is not in
 * the comparison. That is the right behaviour and a surprising one, so it is
 * said rather than assumed.
 */
const dirtyWarnings = async (loaded: LoadedConfig, headRef: string | null): Promise<DiffWarning[]> => {
  if (headRef === null) return [];
  const found: DiffWarning[] = [];
  for (const service of loaded.config.services) {
    if (!(await isDirty(loaded.repoDir(service)))) continue;
    found.push({
      reason: 'dirty-working-tree',
      service: service.name,
      message: `${service.name} has uncommitted changes, which are not in this comparison because a head ref was named`,
      hint: `Leave the head ref out to compare ${service.name} as it stands.`,
    });
  }
  return found;
};

/**
 * The blast radius, bounded by how many changed nodes are worth walking.
 *
 * A revision that touches a thousand nodes would otherwise be a thousand
 * traversals, and a document nobody reads. The bound is on the walking rather
 * than on the diff: `nodes.changed` is always complete in the file.
 */
const impactOf = (
  built: { head: BuildAtRefResult; base: BuildAtRefResult },
  diff: ReturnType<typeof diffGraphs>,
  limits: { maxEntries: number; maxNodes: number },
): { rows: BlastRow[]; skipped: number } => {
  const wanted = impactedNodes(diff);
  const taken = wanted.slice(0, limits.maxNodes);
  const head = openGraphDb(built.head.dbPath);
  const base = openGraphDb(built.base.dbPath);
  try {
    const rows: BlastRow[] = [];
    const onHead = taken.filter((item) => item.side === 'head').map((item) => item.id);
    const onBase = taken.filter((item) => item.side === 'base').map((item) => item.id);
    rows.push(...blastRadius(head, onHead, { maxEntries: limits.maxEntries, side: 'head' }).rows);
    rows.push(...blastRadius(base, onBase, { maxEntries: limits.maxEntries, side: 'base' }).rows);
    return { rows, skipped: wanted.length - taken.length };
  } finally {
    head.close();
    base.close();
  }
};

/**
 * Runs the comparison and draws it.
 *
 * The document is written before anything is printed or any exit code is
 * decided, so a run that fails a pipeline still leaves the artefact explaining
 * why it failed.
 */
export const runDiff = async (
  baseRef: string,
  headRef: string | undefined,
  options: DiffOptions,
  io: QueryIo = processIo,
): Promise<DiffRun> => {
  const started = Date.now();
  const format = oneOf(options.format, FORMATS, 'markdown', '--format');
  const maxEntries = whole(options.maxEntries, 150, '--max-entries');
  const maxNodes = whole(options.maxNodes, 100, '--max-nodes');

  const loaded = loadConfig(options.config ?? process.cwd());
  const services = wantedServices(loaded, options.service);
  const head = headRef ?? null;

  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  mkdirSync(outputDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'flowatlas-diff-'));

  const shared = {
    workDir,
    cacheDir: outputDir,
    ...(options.cache === false ? { cache: false } : {}),
    ...(options.keepWorktrees === true ? { keepWorktrees: true } : {}),
    ...(options.concurrency === undefined
      ? {}
      : { concurrency: whole(options.concurrency, 1, '--concurrency') }),
  };

  try {
    // The head side first, and in full: it is what ships, it is what the blast
    // radius is walked on, and it is what a repository the base ref does not
    // reach falls back to.
    const builtHead = await buildAtRef(loaded, head, { ...shared, side: 'head' });
    const builtBase = await buildAtRef(loaded, baseRef, {
      ...shared,
      side: 'base',
      services,
      inherit: builtHead.repoGraphs,
      inheritSources: builtHead.sources,
    });

    const diffStarted = Date.now();
    const settings = loaded.config.contracts;
    const check: CheckOptions = {
      depth: settings.depth,
      disableRules: settings.rules.disable,
      ignoreEdges: settings.ignoreEdges,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
    };
    const diff = diffGraphs(builtBase.graph, builtHead.graph, {
      depth: settings.depth,
      disableRules: settings.rules.disable,
    });
    const impact = impactOf({ head: builtHead, base: builtBase }, diff, { maxEntries, maxNodes });
    const contracts = classifyContracts(
      checkContracts(builtBase.graph, check),
      checkContracts(builtHead.graph, check),
    );
    const diffMs = Date.now() - diffStarted;

    const warnings: DiffWarning[] = [
      ...builtHead.warnings,
      ...builtBase.warnings,
      ...(await dirtyWarnings(loaded, head)),
    ];
    if (impact.skipped > 0) {
      warnings.push({
        reason: 'impact-truncated',
        service: null,
        message: `${impact.skipped} changed nodes were not walked backwards; the diff below them is complete, the impact table is not`,
        hint: `Raise --max-nodes above ${maxNodes}, or narrow the run with --service.`,
      });
    }

    const report: DiffReport = {
      diffFormatVersion: DIFF_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      base: sideOf(baseRef, builtBase),
      head: sideOf(head, builtHead),
      nodes: diff.nodes,
      edges: diff.edges,
      types: diff.types,
      counts: diff.counts,
      impact: impact.rows,
      contracts,
      warnings,
      timing: {
        baseMs: builtBase.ms,
        headMs: builtHead.ms,
        diffMs,
        totalMs: Date.now() - started,
      },
    };

    // Read back through the schema before anything reads it from disk: a
    // document a consumer cannot parse is worse than one that was never written.
    graphDiffSchema.parse(report);

    const file = join(outputDir, DIFF_FILE);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const text =
      format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderDiffMarkdown(report, { file });
    io.out(text);
    io.err(`${summariseDiff(report)}\n`);
    for (const kept of [...builtHead.worktrees, ...builtBase.worktrees]) {
      io.err(`worktree kept: ${kept}\n`);
    }

    if (options.output !== undefined) {
      const target = isAbsolute(options.output) ? options.output : resolve(options.output);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text, 'utf8');
    }

    const breaks = contractBreaks(contracts);
    /**
     * A service neither ref could be read for, which makes the whole answer a
     * statement about less than it was asked about.
     *
     * A gate that passes here is the one failure this tool is not allowed:
     * every service assumed unchanged, a verdict of nothing broken, and a green
     * tick on a pull request that renamed a route. `--fail-on-contract-break`
     * asks whether this revision is safe to merge, and the honest answer when
     * something could not be read is no.
     */
    const unread = new Set(
      report.warnings
        .filter((warning) => warning.reason === 'not-a-git-repo' || warning.reason === 'ref-not-found')
        .map((warning) => warning.service ?? '')
        .filter((name) => name !== ''),
    );
    const refused = options.failOnContractBreak === true && (breaks.length > 0 || unread.size > 0);
    return {
      report,
      text,
      file,
      exitCode: refused ? EXIT.failed : EXIT.ok,
      ...(unread.size === 0 ? {} : { unread: [...unread] }),
    };
  } finally {
    if (options.keepWorktrees === true) io.err(`work kept: ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
};

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const registerDiff = (program: Command): void => {
  program
    .command('diff')
    .description('what a branch changes, who would notice, and what it breaks')
    .argument('<base-ref>', 'the ref to compare against, e.g. main')
    .argument('[head-ref]', 'the ref to compare (default: the working tree)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--service <name>', 'compare only this repository, repeatable', collect, [])
    .option('--format <name>', `one of ${FORMATS.join(', ')}`)
    .option('--output <file>', 'write what was printed to this file as well')
    .option('--fail-on-contract-break', 'exit 1 when this revision introduces a contract error')
    .option('--max-entries <n>', 'most ways in to list per changed node')
    .option('--max-nodes <n>', 'most changed nodes to walk backwards from')
    .option('--concurrency <n>', 'how many repositories to read at once')
    .option('--out <dir>', 'where to write diff.json (default: the configured output)')
    .option('--no-cache', 'read every commit again rather than believing the cache')
    .option('--keep-worktrees', 'leave the detached checkouts on disk, for debugging')
    .action(async (baseRef: string, headRef: string | undefined, options: DiffOptions) => {
      const { exitCode, unread } = await runDiff(baseRef, headRef, options);
      if (exitCode !== EXIT.ok) {
        throw new CliError(
          unread === undefined
            ? 'this revision introduces a contract error'
            : `${unread.join(', ')} could not be read at either ref, so this comparison does not cover ${unread.length === 1 ? 'it' : 'them'}`,
          EXIT.failed,
        );
      }
    });

  // `flowatlas cache` exists only to manage what `diff` writes, so the two are
  // registered together and `index.ts` grows one line rather than two.
  registerCache(program);
};
