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
 * broke — and only on the ones it broke. `--fail-on-rule-break` does the same
 * for the architecture rules (P114): a violation this branch introduced.
 *
 * `--env <name>` puts what an environment runs in place of the base ref
 * (P193): each service at its pin, read the way `check --env` reads it, and
 * the same document `check` carries under its verdict, without the verdict.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { checkContracts, type CheckOptions } from '@flowatlas/contracts';
import { loadConfig, ruleSetOf, SCHEMA_VERSION, type LoadedConfig } from '@flowatlas/core';
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
  type GraphDb,
} from '@flowatlas/linker';
import { DEFAULT_WALK_NODES } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { cannotRun, CliError, EXIT } from '../exit.js';
import { buildAtRef, type BuildAtRefOptions, type BuildAtRefResult } from '../git/build-at-ref.js';
import { environmentNameOf, pinSourcesOf, readEnvironment, type EnvironmentSaid, type PinFlags } from '../git/environment.js';
import { isDirty } from '../git/worktree.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { environmentLead } from '../report/check-render.js';
import { classifyContracts, contractBreaks } from '../report/contract-delta.js';
import { DIFF_MARKDOWN_DEFAULTS, DIFF_SECTIONS, renderDiffMarkdown, summariseDiff } from '../report/diff-markdown.js';
import { flowChanges } from '../report/flow-changes.js';
import { staleDocsOf, type StaleDocs } from '../report/stale-docs.js';
import { classifyRules, ruleBreaks } from '../report/rule-delta.js';
import { specBetween } from '../report/spec-delta.js';
import { ruleReportOf } from './rules.js';
import { sequenceDetailOf } from './flow.js';
import {
  deliverSarif,
  diffFindings,
  lookupOf,
  sarifBound,
  sarifLevelFlag,
  sarifPathsOf,
  toSarif,
  withSarifOptions,
} from '../sarif/index.js';
import { VERSION } from '../version.js';
import { registerCache } from './cache.js';

export const FORMATS = ['markdown', 'json', 'sarif'] as const;
export type DiffFormat = (typeof FORMATS)[number];

/** The file every run leaves behind, whatever it printed. */
export const DIFF_FILE = 'diff.json';

/** `--pin`, `--pins` and `FLOWATLAS_PIN_*` count only with `--env`, as in `check`. */
export interface DiffOptions extends PinFlags {
  config?: string;
  /**
   * Repositories to compare. Every other one is the same on both sides: its
   * head, or with `--env` what the environment runs.
   */
  service?: string[];
  /** The base side is what this environment runs, in place of a base ref (P193). */
  env?: string;
  format?: string;
  /**
   * Where to write what was printed. The JSON document is always written too.
   * With `--format sarif`, the log goes there instead of stdout (P115).
   */
  output?: string;
  /** With `--format sarif`: paths relative to this checkout. */
  sarifRoot?: string;
  /** With `--format sarif`: the least level written. */
  sarifLevel?: string;
  failOnContractBreak?: boolean;
  /** Exit 1 when this revision introduces a violation of an architecture rule at `error` (P114). */
  failOnRuleBreak?: boolean;
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
  /** Most changed flows drawn in the Markdown; the rest are named and counted (P116). */
  maxDiagrams?: string;
  /** Unchanged steps kept on each side of a change; longer runs fold to a count. */
  context?: string;
  /** `service` or `class`: what a participant of a flow's diagram is. */
  sequenceDetail?: string;
  /** About the most characters the Markdown may take; diagrams go first, from the last. */
  maxChars?: string;
  /** Commander sets this to false for `--no-diagrams`: step lists without the Mermaid. */
  diagrams?: boolean;
  /** Most ways in walked for `flows`; the rest are counted in a warning. */
  maxFlows?: string;
  /** Write both sides' API documents in memory and add their changes as `spec` (P118). */
  spec?: boolean;
  /** Only these parts of the Markdown, e.g. `impact`; `diff.json` stays whole. */
  section?: string[];
}

export interface DiffRun {
  report: DiffReport;
  text: string;
  /** Where the complete document was written. */
  file: string;
  exitCode: number;
  /** Services neither ref could be read for, when there were any. */
  unread?: string[];
  /** The head side's doc blocks the branch makes stale, and those stale already (P120). */
  docs: StaleDocs;
  /** What a failing run failed on: a new contract error, a new rule violation, or both. */
  failedOn?: Array<'contract' | 'rule'>;
  /** With `--env`: what the environment runs and what moved, as `check` says it. */
  environment?: EnvironmentSaid;
}

export const oneOf = <T extends string>(
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

export const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw cannotRun(`${flag} must be a whole number of at least 1, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

/** A count that may be zero: `--context 0` folds every unchanged step. */
export const count = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw cannotRun(`${flag} must be a whole number of at least 0, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

/** How many ways in a run walks for its flows when nobody says. */
export const DEFAULT_MAX_FLOWS = 50;

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
  dbs: { head: GraphDb; base: GraphDb },
  diff: ReturnType<typeof diffGraphs>,
  limits: { maxEntries: number; maxNodes: number },
): { rows: BlastRow[]; skipped: number } => {
  const wanted = impactedNodes(diff);
  const taken = wanted.slice(0, limits.maxNodes);
  const rows: BlastRow[] = [];
  const onHead = taken.filter((item) => item.side === 'head').map((item) => item.id);
  const onBase = taken.filter((item) => item.side === 'base').map((item) => item.id);
  rows.push(...blastRadius(dbs.head, onHead, { maxEntries: limits.maxEntries, side: 'head' }).rows);
  rows.push(...blastRadius(dbs.base, onBase, { maxEntries: limits.maxEntries, side: 'base' }).rows);
  return { rows, skipped: wanted.length - taken.length };
};

/** Both sides' databases, open for as long as `use` reads them. */
const withGraphs = <T>(built: { head: BuildAtRefResult; base: BuildAtRefResult }, use: (dbs: { head: GraphDb; base: GraphDb }) => T): T => {
  const head = openGraphDb(built.head.dbPath);
  const base = openGraphDb(built.base.dbPath);
  try {
    return use({ head, base });
  } finally {
    head.close();
    base.close();
  }
};

/** What `compareBuilt` reads: the two sides as built, and the bounds of the walking. */
export interface CompareInput {
  loaded: LoadedConfig;
  base: BuildAtRefResult;
  head: BuildAtRefResult;
  /** How each side is named in the document: the ref, an environment, or null for the working tree. */
  baseRef: string | null;
  headRef: string | null;
  limits: { maxEntries: number; maxNodes: number; maxFlows: number };
  sequenceDetail: ReturnType<typeof sequenceDetailOf>;
  generatedAt: string;
  /** When the run started, for `timing.totalMs`. */
  started: number;
  /** Said beside the two sides' own warnings. */
  warnings?: readonly DiffWarning[];
  /** Compare the two sides' API documents too (`diff --spec`, P118). */
  spec?: boolean;
}

/**
 * The whole comparison of two built sides, as the document `diff.json` is
 * (P117 shares it with `check`): the node, edge and type diff, the lost joins,
 * the blast radius, the changed flows, the contracts and the rules, each
 * classified by what the head side did to the base side's.
 */
export const compareBuilt = (input: CompareInput): DiffReport => {
  const { loaded, base: builtBase, head: builtHead, limits } = input;
  const { maxEntries, maxNodes, maxFlows } = limits;
  const diffStarted = Date.now();
  const settings = loaded.config.contracts;
  const check: CheckOptions = {
    depth: settings.depth,
    disableRules: settings.rules.disable,
    ignoreEdges: settings.ignoreEdges,
    generatedAt: input.generatedAt,
  };
  const diff = diffGraphs(builtBase.graph, builtHead.graph, {
    depth: settings.depth,
    disableRules: settings.rules.disable,
  });
  // The head's rules on both sides, excused by the head's accepted.json: the
  // question is what this revision does to the rules the project has now.
  const ruleSet = ruleSetOf(loaded.config);
  const acceptedBeside = join(loaded.outputDir, 'graph.db');
  const { impact, flows, rules } = withGraphs({ head: builtHead, base: builtBase }, (dbs) => {
    const rows = impactOf(dbs, diff, { maxEntries, maxNodes });
    return {
      rules: classifyRules(ruleReportOf(dbs.base, ruleSet, acceptedBeside), ruleReportOf(dbs.head, ruleSet, acceptedBeside)),
      impact: rows,
      flows: flowChanges({ impact: rows.rows, nodes: diff.nodes, types: diff.types }, dbs, {
        maxFlows,
        maxNodes: DEFAULT_WALK_NODES,
        detail: input.sequenceDetail,
      }),
    };
  });
  const contracts = classifyContracts(checkContracts(builtBase.graph, check), checkContracts(builtHead.graph, check));
  const spec = input.spec === true ? specBetween(loaded, builtBase.graph, builtHead.graph) : null;
  const diffMs = Date.now() - diffStarted;

  const warnings: DiffWarning[] = [...builtHead.warnings, ...builtBase.warnings, ...(input.warnings ?? [])];
  if (impact.skipped > 0) {
    warnings.push({
      reason: 'impact-truncated',
      service: null,
      message: `${impact.skipped} changed nodes were not walked backwards; the diff below them is complete, the impact table is not`,
      hint: `Raise --max-nodes above ${maxNodes}, or narrow the run with --service.`,
    });
  }
  if (flows.skipped > 0) {
    warnings.push({
      reason: 'flows-truncated',
      service: null,
      message: `${flows.skipped} ways in were not walked for their flows; the impact table lists them, Changed flows does not`,
      hint: `Raise --max-flows above ${maxFlows}, or narrow the run with --service.`,
    });
  }

  return {
    diffFormatVersion: DIFF_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    base: sideOf(input.baseRef, builtBase),
    head: sideOf(input.headRef, builtHead),
    nodes: diff.nodes,
    edges: diff.edges,
    types: diff.types,
    counts: diff.counts,
    unresolved: diff.unresolved,
    joins: diff.joins,
    impact: impact.rows,
    flows: flows.flows,
    contracts,
    rules,
    spec,
    warnings,
    timing: {
      baseMs: builtBase.ms,
      headMs: builtHead.ms,
      diffMs,
      totalMs: Date.now() - input.started,
    },
  };
};

/** How both sides are read: where, from which cache, and how many at a time. */
export const sharedBuild = (
  workDir: string,
  outputDir: string,
  options: { cache?: boolean; keepWorktrees?: boolean; concurrency?: string },
): Omit<BuildAtRefOptions, 'side'> => ({
  workDir,
  cacheDir: outputDir,
  ...(options.cache === false ? { cache: false } : {}),
  ...(options.keepWorktrees === true ? { keepWorktrees: true } : {}),
  ...(options.concurrency === undefined ? {} : { concurrency: whole(options.concurrency, 1, '--concurrency') }),
});

/**
 * Both sides built, as `diff` and `spec diff` read them (one cache): the head
 * side first, and in full - it is what ships, it is what the blast radius is
 * walked on, and it is what a repository the base ref does not reach falls
 * back to - then the base side of the repositories compared.
 */
export const buildSides = async (
  loaded: LoadedConfig,
  baseRef: string,
  headRef: string | null,
  services: readonly string[],
  shared: Omit<BuildAtRefOptions, 'side'>,
): Promise<{ head: BuildAtRefResult; base: BuildAtRefResult }> => {
  const head = await buildAtRef(loaded, headRef, { ...shared, side: 'head' });
  const base = await buildAtRef(loaded, baseRef, {
    ...shared,
    side: 'base',
    services,
    inherit: head.repoGraphs,
    inheritSources: head.sources,
  });
  return { head, base };
};

/**
 * Both sides of `diff --env` (P193), as `check --env` reads them: the base
 * every pinned service at its pin, the head the same with the services that
 * move (`--service`, or every one whose head differs from its pin) at the
 * head ref or the working tree. A pin that names nothing to read stops the
 * run (exit 2): a comparison with an environment never assumes a service is
 * what its working tree is.
 */
const environmentSides = async (
  loaded: LoadedConfig,
  environment: string,
  headRef: string | null,
  shipped: readonly string[] | undefined,
  pinFlags: PinFlags,
  shared: Omit<BuildAtRefOptions, 'side'>,
): Promise<{ head: BuildAtRefResult; base: BuildAtRefResult; said: EnvironmentSaid }> => {
  const sources = pinSourcesOf(loaded, pinFlags);
  const read = await readEnvironment(environment, { loaded, sources, shipped, head: headRef, build: shared });
  if (read.sides === null) {
    const [first, ...rest] = read.refusals;
    throw cannotRun(`cannot read what ${environment} runs: ${first?.message ?? 'nothing pinned'}`, [
      ...(first === undefined ? [] : [first.hint]),
      ...rest.map((refusal) => `${refusal.message}. ${refusal.hint}`),
    ]);
  }
  const said: EnvironmentSaid = {
    environment,
    pinsFile: sources.file,
    pins: read.pins,
    moved: read.moved,
    notDeployed: read.notDeployed,
    notes: read.moved.length === 0 && shipped === undefined ? [...read.notes, `nothing differs from what ${environment} runs`] : read.notes,
  };
  return { head: read.sides.candidate, base: read.sides.deployed, said };
};

/** What the base side is: a ref every repository is read at, or what an environment runs. */
type BaseSide = { kind: 'ref'; ref: string } | { kind: 'environment'; environment: string };

/**
 * The base side the arguments name. `<base-ref>` and `--env` are exclusive;
 * the pins flags say what an environment runs, so they need one.
 */
const baseSideOf = (baseRef: string | undefined, options: DiffOptions): BaseSide => {
  if (options.env !== undefined) {
    const environment = environmentNameOf(options.env);
    if (baseRef !== undefined) {
      throw cannotRun(`--env ${environment} and the base ref ${baseRef} are exclusive: the environment is the base side`, [
        `Name the head alone: flowatlas diff --env ${environment} [head-ref].`,
      ]);
    }
    return { kind: 'environment', environment };
  }
  if (baseRef === undefined) {
    throw cannotRun('a base ref is required: flowatlas diff <base-ref> [head-ref], or flowatlas diff --env <name> [head-ref]');
  }
  if ((options.pin ?? []).length > 0 || options.pins !== undefined) {
    throw cannotRun('--pin and --pins say what an environment runs, so they need --env <name>');
  }
  return { kind: 'ref', ref: baseRef };
};

/**
 * Runs the comparison and draws it.
 *
 * The document is written before anything is printed or any exit code is
 * decided, so a run that fails a pipeline still leaves the artefact explaining
 * why it failed.
 */
export const runDiff = async (
  baseRef: string | undefined,
  headRef: string | undefined,
  options: DiffOptions,
  io: QueryIo = processIo,
): Promise<DiffRun> => {
  const started = Date.now();
  const format = oneOf(options.format, FORMATS, 'markdown', '--format');
  const maxEntries = whole(options.maxEntries, 150, '--max-entries');
  const maxNodes = whole(options.maxNodes, 100, '--max-nodes');
  const maxFlows = count(options.maxFlows, DEFAULT_MAX_FLOWS, '--max-flows');
  const markdown = {
    maxDiagrams: count(options.maxDiagrams, DIFF_MARKDOWN_DEFAULTS.maxDiagrams, '--max-diagrams'),
    context: count(options.context, DIFF_MARKDOWN_DEFAULTS.context, '--context'),
    maxChars: whole(options.maxChars, DIFF_MARKDOWN_DEFAULTS.maxChars, '--max-chars'),
    diagrams: options.diagrams !== false,
  };
  const sections = (options.section ?? []).map((name) => oneOf(name, DIFF_SECTIONS, 'impact', '--section'));
  if (sections.length > 0 && format !== 'markdown') {
    throw cannotRun(`--section picks parts of the Markdown, and --format ${format} writes the whole report`, [
      'Leave out --format, or leave out --section.',
    ]);
  }
  const sequenceDetail = sequenceDetailOf(options.sequenceDetail);
  const sarifLevel = sarifLevelFlag(options.sarifLevel);

  const against = baseSideOf(baseRef, options);

  const loaded = loadConfig(options.config ?? process.cwd());
  const services = wantedServices(loaded, options.service);
  const head = headRef ?? null;

  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  mkdirSync(outputDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'flowatlas-diff-'));

  const shared = sharedBuild(workDir, outputDir, options);

  try {
    const sides =
      against.kind === 'ref'
        ? { ...(await buildSides(loaded, against.ref, head, services, shared)), said: undefined }
        : await environmentSides(loaded, against.environment, head, (options.service ?? []).length > 0 ? services : undefined, options, shared);
    const { head: builtHead, base: builtBase, said } = sides;
    // With --env, a service that stays as deployed is read at its pin whatever its tree holds.
    const moving = said === undefined ? null : new Set(said.moved.map((move) => move.service));
    const dirty = (await dirtyWarnings(loaded, head)).filter((warning) => moving === null || moving.has(warning.service ?? ''));

    const report = compareBuilt({
      loaded,
      base: builtBase,
      head: builtHead,
      baseRef: against.kind === 'ref' ? against.ref : against.environment,
      headRef: head,
      limits: { maxEntries, maxNodes, maxFlows },
      sequenceDetail,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      started,
      warnings: dirty,
      ...(options.spec === true ? { spec: true } : {}),
    });
    const { contracts, rules } = report;
    const ruleSet = ruleSetOf(loaded.config);
    // Read, never written: `diff` says which pages to update, `docs --write` updates them (P120).
    const docs = withGraphs({ head: builtHead, base: builtBase }, (dbs) => staleDocsOf(loaded, head, dbs));

    // Read back through the schema before anything reads it from disk: a
    // document a consumer cannot parse is worse than one that was never written.
    graphDiffSchema.parse(report);

    const file = join(outputDir, DIFF_FILE);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    // The new and fixed contract findings and rule violations (P115): a new
    // one placed on the head side, a fixed one where it was on the base side.
    const text =
      format === 'sarif'
        ? deliverSarif(
            toSarif({
              command: 'diff',
              version: VERSION,
              findings: diffFindings(report, { head: lookupOf(builtHead.graph), base: lookupOf(builtBase.graph) }),
              paths: sarifPathsOf({ config: loaded.configPath }, options.sarifRoot),
              maxResults: sarifBound(undefined),
              ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
              completeFile: file,
            }),
            options.output === undefined ? {} : { output: options.output },
            io,
          )
        : format === 'json'
          ? `${JSON.stringify(report, null, 2)}\n`
          : renderDiffMarkdown(report, { file, ...markdown, docs, sections, ...(said === undefined ? {} : { lead: environmentLead(said, head) }) });
    if (format !== 'sarif') io.out(text);
    io.err(`${summariseDiff(report)}\n`);
    for (const note of said?.notes ?? []) io.err(`note: ${note}\n`);
    for (const kept of [...builtHead.worktrees, ...builtBase.worktrees]) {
      io.err(`worktree kept: ${kept}\n`);
    }

    if (options.output !== undefined && format !== 'sarif') {
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
    const ruleBroken = ruleBreaks(rules, ruleSet.failOnHeuristic);
    const refusedContracts = options.failOnContractBreak === true && (breaks.length > 0 || unread.size > 0);
    const refusedRules = options.failOnRuleBreak === true && (ruleBroken.length > 0 || unread.size > 0);
    const failedOn = [
      ...(refusedContracts && breaks.length > 0 ? ['contract' as const] : []),
      ...(refusedRules && ruleBroken.length > 0 ? ['rule' as const] : []),
    ];
    return {
      report,
      text,
      file,
      exitCode: refusedContracts || refusedRules ? EXIT.failed : EXIT.ok,
      ...(unread.size === 0 ? {} : { unread: [...unread] }),
      docs,
      ...(failedOn.length === 0 ? {} : { failedOn }),
      ...(said === undefined ? {} : { environment: said }),
    };
  } finally {
    if (options.keepWorktrees === true) io.err(`work kept: ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
};

export const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const registerDiff = (program: Command): void => {
  const command = program
    .command('diff')
    .description('what a branch changes, who would notice, and what it breaks')
    .argument('[base-ref]', 'the ref to compare against, e.g. main (left out with --env)')
    .argument('[head-ref]', 'the ref to compare (default: the working tree)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--env <name>', 'compare with what this environment runs, each service at its pin, in place of a base ref')
    .option('--pin <service=ref>', 'with --env: the ref a service runs, over the pins file, repeatable', collect, [])
    .option('--pins <path>', 'with --env: the pins file (default: deployed.file, or flowatlas.deployed.json beside the configuration)')
    .option('--service <name>', 'compare only this repository, repeatable (with --env: the ones that move)', collect, [])
    .option('--format <name>', `one of ${FORMATS.join(', ')}`)
    .option('--section <name>', `only this part of the Markdown: ${DIFF_SECTIONS.join(', ')} (repeatable)`, collect, [])
    .option('--output <file>', 'write what was printed to this file as well; with --format sarif, the log goes there instead of stdout')
    .option('--fail-on-contract-break', 'exit 1 when this revision introduces a contract error')
    .option('--fail-on-rule-break', 'exit 1 when this revision introduces a violation of an architecture rule at error')
    .option('--max-entries <n>', 'most ways in to list per changed node')
    .option('--max-nodes <n>', 'most changed nodes to walk backwards from')
    .option('--max-flows <n>', `most ways in to walk for their flows (default ${DEFAULT_MAX_FLOWS})`)
    .option('--max-diagrams <n>', `most changed flows to draw (default ${DIFF_MARKDOWN_DEFAULTS.maxDiagrams})`)
    .option('--context <n>', `unchanged steps kept beside a change in a flow (default ${DIFF_MARKDOWN_DEFAULTS.context})`)
    .option('--sequence-detail <level>', 'one participant per service (default) or per class')
    .option('--max-chars <n>', `about the most characters of Markdown (default ${DIFF_MARKDOWN_DEFAULTS.maxChars})`)
    .option('--no-diagrams', 'list the steps of each changed flow without its Mermaid diagram')
    .option('--spec', 'compare the two sides\' OpenAPI and AsyncAPI documents too, under "API changes"')
    .option('--concurrency <n>', 'how many repositories to read at once')
    .option('--out <dir>', 'where to write diff.json (default: the configured output)')
    .option('--no-cache', 'read every commit again rather than believing the cache')
    .option('--keep-worktrees', 'leave the detached checkouts on disk, for debugging');
  withSarifOptions(command, { output: false }).action(async (first: string | undefined, second: string | undefined, options: DiffOptions) => {
      // With --env the one ref given is the head: `diff --env prod drop-lookup`.
      if (options.env !== undefined && second !== undefined) {
        throw cannotRun(`--env ${options.env} and the base ref ${first ?? ''} are exclusive: the environment is the base side`, [
          `Name the head alone: flowatlas diff --env ${options.env} ${second}.`,
        ]);
      }
      const [baseRef, headRef] = options.env === undefined ? [first, second] : [undefined, first];
      const { exitCode, unread, failedOn } = await runDiff(baseRef, headRef, options);
      if (exitCode !== EXIT.ok) {
        const said = { contract: 'a contract error', rule: 'a violation of an architecture rule' } as const;
        throw new CliError(
          unread === undefined
            ? `this revision introduces ${(failedOn ?? ['contract']).map((what) => said[what]).join(' and ')}`
            : `${unread.join(', ')} could not be read at either ref, so this comparison does not cover ${unread.length === 1 ? 'it' : 'them'}`,
          EXIT.failed,
        );
      }
    });

  // `flowatlas cache` exists only to manage what `diff` writes, so the two are
  // registered together and `index.ts` grows one line rather than two.
  registerCache(program);
};
