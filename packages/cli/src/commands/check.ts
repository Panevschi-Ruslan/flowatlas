/**
 * `flowatlas check --env <name>` — can this be deployed there (P117).
 *
 * `diff` asks whether a branch agrees with `main`. A release pipeline asks
 * something else: whether the version about to ship agrees with the versions
 * running where it ships to. `main` of another service is often ahead of what
 * is deployed, so a branch that agrees with it can break the one that runs.
 *
 * The pins file (`flowatlas.deployed.json`, or `--pin`, or
 * `FLOWATLAS_PIN_<SERVICE>`) says which ref of each service each environment
 * runs. The deployed side is every service at its pin; the candidate side is
 * the same with the services being shipped (`--service`, or every one whose
 * head differs from its pin) at `--head` or the working tree. The comparison
 * is `diff`'s, deployed as base; the verdict counts only what the candidate
 * introduces (D1). A pin that names nothing to read is never read as the
 * working tree in its place (D3, I3): the run says it could not decide.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  DeployedInvalidError,
  deployedPathOf,
  loadConfig,
  loadDeployed,
  parsePinFlags,
  pinsFor,
  pinsFromEnv,
  ruleSetOf,
  type Deployed,
  type LoadedConfig,
  type Pin,
  type ProjectGraph,
} from '@flowatlas/core';
import {
  CHECK_FORMAT_VERSION,
  checkReportSchema,
  graphDiffSchema,
  type CheckMove,
  type CheckPin,
  type CheckRefusal,
  type CheckReport,
  type CheckVerdictWord,
  type DiffReport,
} from '@flowatlas/linker';
import type { Command } from 'commander';
import { cannotRun, CliError, EXIT, type ExitCode } from '../exit.js';
import { buildAtRef, UnreadableAtRef, type BuildAtRefOptions } from '../git/build-at-ref.js';
import { isDirty, isGitRepo, resolveSha } from '../git/worktree.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { checkReasonsOf } from '../report/check-verdict.js';
import { renderCheckMarkdown, renderCheckText, summariseCheck } from '../report/check-render.js';
import { DIFF_MARKDOWN_DEFAULTS } from '../report/diff-markdown.js';
import {
  checkFindings,
  deliverSarif,
  lookupOf,
  sarifBound,
  sarifLevelFlag,
  sarifPathsOf,
  toSarif,
  withSarifOptions,
  type CheckSarifInput,
} from '../sarif/index.js';
import { VERSION } from '../version.js';
import { collect, compareBuilt, count, DEFAULT_MAX_FLOWS, oneOf, whole } from './diff.js';
import { sequenceDetailOf } from './flow.js';

export const CHECK_FORMATS = ['text', 'markdown', 'json', 'sarif'] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

/** The document each environment's run leaves behind, whatever it printed. */
export const checkFileOf = (environment: string): string => `check.${environment}.json`;

export interface CheckCommandOptions {
  config?: string;
  /** Environments to answer for, each a section; the exit is the worst. */
  env?: string[];
  /** The services being shipped. Without it, every service whose head differs from its pin. */
  service?: string[];
  /** The ref the shipped services are read at; the working tree when absent. */
  head?: string;
  /** `<service>=<ref>`, over the pins file and the environment variables. */
  pin?: string[];
  /** The pins file, in place of `deployed.file` or `flowatlas.deployed.json`. */
  pins?: string;
  format?: string;
  /** Where to write what was printed; with `--format sarif`, the log alone. */
  output?: string;
  sarifRoot?: string;
  sarifLevel?: string;
  maxEntries?: string;
  maxNodes?: string;
  maxFlows?: string;
  concurrency?: string;
  /** Commander sets this to false for `--no-cache`. */
  cache?: boolean;
  keepWorktrees?: boolean;
  /** Where `check.<env>.json` and `cache/` go. Defaults to the configured output. */
  out?: string;
  /** Fixed timestamp, for output that is the same on two runs. */
  generatedAt?: string;
  /** Where `FLOWATLAS_PIN_*` are read from; the process's environment when absent. */
  environ?: Readonly<Record<string, string | undefined>>;
}

/** One environment's answer, with both sides' graphs for placing its findings. */
export interface CheckSection {
  report: CheckReport;
  file: string;
  exitCode: ExitCode;
  deployed?: ProjectGraph;
  candidate?: ProjectGraph;
}

export interface CheckRun {
  sections: CheckSection[];
  text: string;
  exitCode: ExitCode;
}

const EXIT_OF: Readonly<Record<CheckVerdictWord, ExitCode>> = {
  deployable: EXIT.ok,
  'not deployable': EXIT.failed,
  undecided: EXIT.cannotRun,
};

const short = (sha: string | null): string => (sha === null ? 'working tree' : sha.slice(0, 8));

/** The configured services `--service` names, refused by name when one is not. */
const shippedServices = (loaded: LoadedConfig, names: readonly string[] | undefined): string[] | undefined => {
  if (names === undefined || names.length === 0) return undefined;
  const known = loaded.config.services.map((service) => service.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw cannotRun(`no service named ${unknown.map((name) => JSON.stringify(name)).join(', ')}`, [`Known services: ${[...known].sort().join(', ')}.`]);
  }
  return [...new Set(names)];
};

/** What the run reads the pins of every environment from. */
interface PinSources {
  deployed: Deployed | null;
  /** The pins file, relative to the configuration, when there is one. */
  file: string | null;
  env: Record<string, string>;
  flags: Record<string, string>;
}

const pinSourcesOf = (loaded: LoadedConfig, options: CheckCommandOptions): PinSources => {
  const services = loaded.config.services.map((service) => service.name);
  const path = deployedPathOf(loaded.rootDir, loaded.config.deployed?.file, options.pins);
  let deployed: Deployed | null;
  try {
    deployed = loadDeployed(path, services);
  } catch (error) {
    if (error instanceof DeployedInvalidError) throw cannotRun(error.message, error.hint === undefined ? [] : [error.hint]);
    throw error;
  }
  if (deployed === null && options.pins !== undefined) throw cannotRun(`no pins file at ${path}`);
  const flags = parsePinFlags(options.pin ?? [], services);
  if (flags.problems.length > 0) throw cannotRun(flags.problems[0] ?? 'a --pin is not <service>=<ref>', flags.problems.slice(1));
  return {
    deployed,
    file: deployed === null ? null : relative(loaded.rootDir, path).replace(/\\/g, '/') || path,
    env: pinsFromEnv(options.environ ?? process.env, services),
    flags: flags.pins,
  };
};

const FROM_SAID: Readonly<Record<Pin['from'], string>> = { file: 'the pins file', env: 'FLOWATLAS_PIN_*', flag: '--pin' };

/**
 * Every pin resolved to a commit, or the refusals that make the environment
 * undecidable: a ref the repository does not have (fetch its tags first), or
 * a service that is a directory inside a repository rather than one.
 */
const resolvePins = async (loaded: LoadedConfig, pins: readonly Pin[]): Promise<{ resolved: CheckPin[]; refusals: CheckRefusal[] }> => {
  const resolved: CheckPin[] = [];
  const refusals: CheckRefusal[] = [];
  for (const pin of pins) {
    const service = loaded.config.services.find((entry) => entry.name === pin.service);
    if (service === undefined) continue;
    const repo = loaded.repoDir(service);
    const sha = (await isGitRepo(repo)) ? await resolveSha(repo, pin.ref) : null;
    resolved.push({ service: pin.service, ref: pin.ref, from: pin.from, sha, ...(pin.replaced === undefined ? {} : { replaced: pin.replaced }) });
    if (sha !== null) continue;
    refusals.push(
      (await isGitRepo(repo))
        ? {
            reason: 'ref-not-found',
            service: pin.service,
            message: `${pin.service}: ${pin.ref} (from ${FROM_SAID[pin.from]}) does not resolve in ${service.repo}`,
            hint: `Fetch it first: git -C ${service.repo} fetch --tags (in CI, check out with fetch-depth: 0).`,
          }
        : {
            reason: 'not-a-git-repo',
            service: pin.service,
            message: `${pin.service}: ${service.repo} is not a git repository root, so it cannot be read at ${pin.ref}`,
            hint: 'check reads every deployed service at its ref; point the service at the root of its repository.',
          },
    );
  }
  return { resolved, refusals };
};

/**
 * The services the candidate side reads somewhere else than their pin.
 *
 * Named ones (`--service`) move unless their head is their pin, which is said
 * ("nothing to deploy for orders"); without names, every pinned service whose
 * head is a different commit, or the same one with uncommitted changes when
 * the head is the working tree.
 */
const movesOf = async (
  loaded: LoadedConfig,
  pins: readonly CheckPin[],
  shipped: readonly string[] | undefined,
  head: string | null,
): Promise<{ moved: CheckMove[]; refusals: CheckRefusal[]; notes: string[] }> => {
  const moved: CheckMove[] = [];
  const refusals: CheckRefusal[] = [];
  const notes: string[] = [];
  const byService = new Map(pins.map((pin) => [pin.service, pin]));
  const candidates = shipped ?? pins.map((pin) => pin.service);
  for (const name of candidates) {
    const service = loaded.config.services.find((entry) => entry.name === name);
    if (service === undefined) continue;
    const repo = loaded.repoDir(service);
    const pin = byService.get(name);
    const git = await isGitRepo(repo);
    const sha = git ? await resolveSha(repo, head ?? 'HEAD') : null;
    if (head !== null && sha === null) {
      if (shipped !== undefined) {
        refusals.push({
          reason: 'head-not-found',
          service: name,
          message: `${name}: --head ${head} does not resolve in ${service.repo}`,
          hint: `Fetch it first (git -C ${service.repo} fetch), or name the ref that holds what ships.`,
        });
      }
      continue;
    }
    const dirty = head === null && git ? await isDirty(repo) : false;
    const from = { ref: pin?.ref ?? null, sha: pin?.sha ?? null };
    if (pin !== undefined && sha !== null && sha === pin.sha && !dirty) {
      if (shipped !== undefined) notes.push(`nothing to deploy for ${name}: ${head ?? 'its working tree'} is ${pin.ref} (${short(pin.sha)})`);
      continue;
    }
    if (pin === undefined) notes.push(`${name} is not deployed here yet: read on the candidate side only`);
    moved.push({ service: name, from, to: { ref: head, sha: head === null && dirty ? null : sha, dirty } });
  }
  return { moved, refusals, notes };
};

/** The notes a header owes the reader: whose ref replaced whose (§10). */
const pinNotes = (pins: readonly CheckPin[]): string[] =>
  pins.flatMap((pin) =>
    pin.replaced === undefined ? [] : [`${pin.service}: ${pin.ref} from ${FROM_SAID[pin.from]}, in place of ${pin.replaced.ref} from ${FROM_SAID[pin.replaced.from]}`],
  );

interface SectionContext {
  loaded: LoadedConfig;
  sources: PinSources;
  shipped: string[] | undefined;
  head: string | null;
  outputDir: string;
  workDir: string;
  generatedAt: string;
  build: Pick<BuildAtRefOptions, 'cache' | 'keepWorktrees' | 'concurrency'>;
  limits: { maxEntries: number; maxNodes: number; maxFlows: number };
  sequenceDetail: ReturnType<typeof sequenceDetailOf>;
}

const undecided = (base: Omit<CheckReport, 'verdict' | 'diff'>, refusals: CheckRefusal[], notes: string[]): CheckReport => ({
  ...base,
  verdict: { verdict: 'undecided', reasons: [], already: [], undecided: refusals, notes },
  diff: null,
});

/** One environment: its pins, its two sides, the comparison and the verdict. */
const checkEnvironment = async (environment: string, ctx: SectionContext): Promise<Omit<CheckSection, 'file' | 'exitCode'>> => {
  const { loaded, sources, head } = ctx;
  const started = Date.now();
  const { pins: wanted, known } = pinsFor(sources.deployed, environment, { env: sources.env, flags: sources.flags });
  const configured = loaded.config.services.map((service) => service.name);
  const base = {
    checkFormatVersion: CHECK_FORMAT_VERSION,
    generatedAt: ctx.generatedAt,
    environment,
    pinsFile: sources.file,
    pins: [] as CheckPin[],
    notDeployed: configured.filter((name) => !wanted.some((pin) => pin.service === name)).sort(),
    moved: [] as CheckMove[],
    head,
  };
  if (!known) {
    const named = Object.keys(sources.deployed?.environments ?? {}).sort();
    return {
      report: undecided(
        base,
        [
          {
            reason: 'unknown-environment',
            service: null,
            message: `no environment named ${JSON.stringify(environment)}${sources.file === null ? ' and no pins file' : ` in ${sources.file}`}${named.length === 0 ? '' : ` (known: ${named.join(', ')})`}`,
            hint: `Record what runs there with flowatlas deployed set ${environment} <service> <ref>, or pass each running version with --pin <service>=<ref>.`,
          },
        ],
        [],
      ),
    };
  }

  const { resolved, refusals } = await resolvePins(loaded, wanted);
  const moves = await movesOf(loaded, resolved, ctx.shipped, head);
  const notes = [...pinNotes(resolved), ...moves.notes];
  const described = { ...base, pins: resolved, moved: moves.moved, notDeployed: base.notDeployed.filter((name) => !moves.moved.some((move) => move.service === name)) };
  if (refusals.length > 0 || moves.refusals.length > 0) return { report: undecided(described, [...refusals, ...moves.refusals], notes) };

  const workDir = join(ctx.workDir, environment);
  const shared = { workDir, cacheDir: ctx.outputDir, fallback: false, ...ctx.build };
  const pinned = new Map(resolved.map((pin) => [pin.service, pin.ref]));
  try {
    const deployed = await buildAtRef(loaded, null, {
      ...shared,
      side: 'base',
      services: resolved.map((pin) => pin.service),
      refFor: (service) => pinned.get(service) ?? null,
    });
    const movedNames = moves.moved.map((move) => move.service);
    const candidate = await buildAtRef(loaded, null, {
      ...shared,
      side: 'head',
      services: movedNames,
      refFor: () => head,
      inherit: deployed.repoGraphs,
      inheritSources: deployed.sources,
    });
    const diff: DiffReport = compareBuilt({
      loaded,
      base: deployed,
      head: candidate,
      baseRef: environment,
      headRef: head,
      limits: ctx.limits,
      sequenceDetail: ctx.sequenceDetail,
      generatedAt: ctx.generatedAt,
      started,
    });
    graphDiffSchema.parse(diff);
    const found = checkReasonsOf(diff, { deployed: deployed.graph, candidate: candidate.graph }, { failOnHeuristic: ruleSetOf(loaded.config).failOnHeuristic });
    if (moves.moved.length === 0 && ctx.shipped === undefined) notes.push(`nothing differs from what ${environment} runs`);
    return {
      report: {
        ...described,
        verdict: {
          verdict: found.reasons.length > 0 ? 'not deployable' : 'deployable',
          reasons: found.reasons,
          already: found.already,
          undecided: [],
          notes: [...notes, ...found.notes],
        },
        diff,
      },
      deployed: deployed.graph,
      candidate: candidate.graph,
    };
  } catch (error) {
    // A ref that moved between resolving it and reading it: still never the working tree.
    if (!(error instanceof UnreadableAtRef)) throw error;
    return {
      report: undecided(
        described,
        [{ reason: error.reason, service: error.service, message: error.message, hint: `Fetch it first: git -C ${error.repo} fetch --tags.` }],
        notes,
      ),
    };
  }
};

/**
 * Runs every environment asked for and draws the answer.
 *
 * Each environment's document is written before anything is printed, so a
 * run that fails a pipeline leaves the artefact saying why. The exit code is
 * the worst of the environments': 2 over 1 over 0.
 */
export const runCheck = async (options: CheckCommandOptions, io: QueryIo = processIo): Promise<CheckRun> => {
  const format = oneOf(options.format, CHECK_FORMATS, 'text', '--format');
  const limits = {
    maxEntries: whole(options.maxEntries, 150, '--max-entries'),
    maxNodes: whole(options.maxNodes, 100, '--max-nodes'),
    maxFlows: count(options.maxFlows, DEFAULT_MAX_FLOWS, '--max-flows'),
  };
  const sarifLevel = sarifLevelFlag(options.sarifLevel);
  const environments = [...new Set(options.env ?? [])];
  if (environments.length === 0) throw cannotRun('--env is required: the environment to check against, e.g. --env prod');
  const bad = environments.find((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name));
  if (bad !== undefined) throw cannotRun(`--env ${JSON.stringify(bad)} is not an environment name (letters, digits, ".", "_" and "-")`);

  const loaded = loadConfig(options.config ?? process.cwd());
  const shipped = shippedServices(loaded, options.service);
  const sources = pinSourcesOf(loaded, options);
  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  mkdirSync(outputDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'flowatlas-check-'));
  const ctx: SectionContext = {
    loaded,
    sources,
    shipped,
    head: options.head ?? null,
    outputDir,
    workDir,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    build: {
      ...(options.cache === false ? { cache: false } : {}),
      ...(options.keepWorktrees === true ? { keepWorktrees: true } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: whole(options.concurrency, 1, '--concurrency') }),
    },
    limits,
    sequenceDetail: sequenceDetailOf(undefined),
  };

  try {
    const sections: CheckSection[] = [];
    for (const environment of environments) {
      const section = await checkEnvironment(environment, ctx);
      checkReportSchema.parse(section.report);
      const file = join(outputDir, checkFileOf(environment));
      writeFileSync(file, `${JSON.stringify(section.report, null, 2)}\n`, 'utf8');
      sections.push({ ...section, file, exitCode: EXIT_OF[section.report.verdict.verdict] });
    }

    const text =
      format === 'sarif'
        ? deliverSarif(
            toSarif({
              command: 'check',
              version: VERSION,
              findings: checkFindings(
                sections.map((section): CheckSarifInput => ({
                  report: section.report,
                  ...(section.deployed === undefined ? {} : { deployed: lookupOf(section.deployed) }),
                  ...(section.candidate === undefined ? {} : { candidate: lookupOf(section.candidate) }),
                })),
              ),
              paths: sarifPathsOf({ config: loaded.configPath }, options.sarifRoot),
              maxResults: sarifBound(undefined),
              ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
              ...(sections.length === 1 && sections[0] !== undefined ? { completeFile: sections[0].file } : {}),
            }),
            options.output === undefined ? {} : { output: options.output },
            io,
          )
        : format === 'json'
          ? `${JSON.stringify(sections.length === 1 ? sections[0]?.report : sections.map((section) => section.report), null, 2)}\n`
          : sections
              .map((section) =>
                format === 'markdown'
                  ? renderCheckMarkdown(section.report, section.file, { maxDiagrams: DIFF_MARKDOWN_DEFAULTS.maxDiagrams })
                  : renderCheckText(section.report, section.file),
              )
              .join('\n');
    if (format !== 'sarif') io.out(text);
    for (const section of sections) io.err(`${summariseCheck(section.report)}\n`);

    if (options.output !== undefined && format !== 'sarif') {
      const target = isAbsolute(options.output) ? options.output : resolve(options.output);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text, 'utf8');
    }
    const exitCode = sections.reduce<ExitCode>((worst, section) => (section.exitCode > worst ? section.exitCode : worst), EXIT.ok);
    return { sections, text, exitCode };
  } finally {
    if (options.keepWorktrees === true) io.err(`work kept: ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
};

/** What a failing run says last, on stderr: the environments and why. */
const failureOf = (run: CheckRun): string => {
  const said = run.sections
    .filter((section) => section.exitCode !== EXIT.ok)
    .map((section) =>
      section.report.verdict.verdict === 'undecided'
        ? `could not decide for ${section.report.environment}: ${section.report.verdict.undecided[0]?.message ?? 'nothing to read'}`
        : `not deployable to ${section.report.environment}`,
    );
  return said.join('; ');
};

export const registerCheck = (program: Command): void => {
  const command = program
    .command('check')
    .description('can this be deployed: what deploying it would break against what an environment runs')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--env <name>', 'the environment to check against, repeatable', collect, [])
    .option('--service <name>', 'a service being shipped, repeatable (default: every service whose head differs from its pin)', collect, [])
    .option('--head <ref>', 'the ref the shipped services are read at (default: the working tree)')
    .option('--pin <service=ref>', 'the ref a service runs, over the pins file, repeatable', collect, [])
    .option('--pins <path>', 'the pins file (default: deployed.file, or flowatlas.deployed.json beside the configuration)')
    .option('--format <name>', `one of ${CHECK_FORMATS.join(', ')}`)
    .option('--output <file>', 'write what was printed to this file as well; with --format sarif, the log goes there instead of stdout')
    .option('--max-entries <n>', 'most ways in to list per changed node')
    .option('--max-nodes <n>', 'most changed nodes to walk backwards from')
    .option('--max-flows <n>', `most ways in to walk for their flows (default ${DEFAULT_MAX_FLOWS})`)
    .option('--concurrency <n>', 'how many repositories to read at once')
    .option('--out <dir>', 'where to write check.<env>.json (default: the configured output)')
    .option('--no-cache', 'read every commit again rather than believing the cache')
    .option('--keep-worktrees', 'leave the detached checkouts on disk, for debugging');
  withSarifOptions(command, { output: false }).action(async (options: CheckCommandOptions) => {
    const run = await runCheck(options);
    if (run.exitCode !== EXIT.ok) throw new CliError(failureOf(run), run.exitCode);
  });
};
