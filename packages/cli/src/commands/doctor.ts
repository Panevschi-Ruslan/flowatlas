/**
 * `flowatlas doctor` — whether the map still tells the truth.
 *
 * Every extractor since the first one records what it could not read, and every
 * annotation since the fourth asserts something no compiler checks. Until now
 * nobody put the two together. This is the command that does, and the one whose
 * exit code a build can be hung on: 0 nothing to report, 1 a check failed,
 * 2 the check could not be run at all.
 *
 * The distinction between 1 and 2 is the whole point of having a gate. A build
 * that goes red because a route was renamed is the tool working; a build that
 * goes red because there is no graph is the tool broken, and a script that
 * cannot tell them apart will eventually be told to ignore both.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadConfig, type Unresolved } from '@flowatlas/core';
import type { CheckOptions } from '@flowatlas/contracts';
import type { GraphDb } from '@flowatlas/linker';
import type { Command } from 'commander';
import { openProjectDb } from '../analysis/open.js';
import { CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { VERSION } from '../version.js';
import {
  acceptedBy,
  readBaseline,
  snapshotOf,
  writeBaseline,
  type Baseline,
  type BaselineRead,
} from '../doctor/baseline.js';
import { renderDoctorGithub, renderDoctorJson, renderDoctorText, summaryLine } from '../doctor/render.js';
import { runDoctor } from '../doctor/run.js';
import {
  BASELINE_FORMAT_VERSION,
  SECTIONS,
  type DoctorReport,
  type Section,
} from '../doctor/schema.js';

export const FORMATS = ['text', 'json', 'github'] as const;
export type DoctorFormat = (typeof FORMATS)[number];

/** The file every run leaves behind, whatever it printed. */
export const DOCTOR_FILE = 'doctor.json';

/** What `--accept` writes, and where `--strict` looks for it. */
export const BASELINE_FILE = 'flowatlas.baseline.json';

export interface DoctorOptions {
  config?: string;
  db?: string;
  format?: string;
  strict?: boolean;
  accept?: boolean;
  /** A path, or `false` when `--no-baseline` was passed. */
  baseline?: string | false;
  section?: string[];
  service?: string;
  /** `false` only when `--no-contracts` was passed. */
  contracts?: boolean;
  maxNodes?: string;
  /** Where to write `doctor.json`. Defaults to the configured output. */
  out?: string;
}

export interface DoctorRun {
  report: DoctorReport;
  text: string;
  /** Where the complete report was written, or undefined when nowhere was known. */
  file?: string;
  /** Where the baseline was written, set only by `--accept`. */
  baselineFile?: string;
  exitCode: number;
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
    throw new CliError(
      `${flag} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`,
      EXIT.cannotRun,
    );
  }
  return found;
};

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(
      `${flag} must be a whole number of at least 1, not ${JSON.stringify(value)}`,
      EXIT.cannotRun,
    );
  }
  return parsed;
};

/** What the project asked for in `flowatlas.config.json`, when there is one. */
interface FromConfig {
  outputDir?: string;
  rootDir?: string;
  baseline?: string;
  ignoreReasons: string[];
  warnAsError: boolean;
  check: CheckOptions;
  envOwners: Map<string, string[]>;
  /** Each service's directory as the configuration writes it, `./` stripped. */
  repoDirs: Map<string, string>;
}

const fromConfig = (options: DoctorOptions): FromConfig => {
  const empty: FromConfig = {
    ignoreReasons: [],
    warnAsError: false,
    check: {},
    envOwners: new Map(),
    repoDirs: new Map(),
  };
  try {
    const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
    const { doctor, contracts, services } = loaded.config;
    const envOwners = new Map<string, string[]>();
    const repoDirs = new Map<string, string>();
    for (const service of services) {
      for (const env of service.baseUrlEnv ?? []) {
        envOwners.set(env, [...(envOwners.get(env) ?? []), service.name]);
      }
      const dir = service.repo.replace(/^\.\//, '').replace(/\/+$/, '');
      if (dir !== '' && dir !== '.') repoDirs.set(service.name, dir);
    }
    return {
      outputDir: loaded.outputDir,
      rootDir: loaded.rootDir,
      ...(doctor.baseline === undefined ? {} : { baseline: doctor.baseline }),
      ignoreReasons: [...doctor.ignoreReasons],
      warnAsError: doctor.markers.warnAsError,
      check: {
        depth: contracts.depth,
        disableRules: [...contracts.rules.disable],
        ignoreEdges: [...contracts.ignoreEdges],
      },
      envOwners,
      repoDirs,
    };
  } catch {
    // Pointed at a bare database with no configuration beside it there is
    // nothing to read, and answering the question beats refusing to.
    return options.db === undefined
      ? empty
      : { ...empty, outputDir: dirname(resolve(options.db)) };
  }
};

/**
 * The rows as the graph wrote them, which is not what the database holds.
 *
 * The database drops the symbol each row names, and without it two methods in
 * one file failing for the same reason are one key to the baseline — so the
 * graph file is read when it belongs to this build. "Belongs to" is checked
 * rather than assumed: a `project-graph.json` left over from an earlier build
 * beside a newer database is exactly the trap that let a whole gate go green on
 * stale output once already, and here it would quietly change the number a
 * build is failed on.
 */
const rowsFor = (db: GraphDb, outputDir: string | undefined): { rows: Unresolved[]; note?: string } => {
  const fallback = (): { rows: Unresolved[] } => ({
    rows: db.allUnresolved().map((row) => ({
      file: row.file ?? '',
      line: row.line ?? 0,
      reason: row.reason,
      level: row.level,
      sites: row.sites,
      message: row.message,
      ...(row.hint === null ? {} : { hint: row.hint }),
      ...(row.service === null ? {} : { service: row.service }),
    })),
  });

  if (outputDir === undefined) return fallback();
  const path = join(outputDir, 'project-graph.json');
  if (!existsSync(path)) {
    return {
      ...fallback(),
      note: `${path} is not there, so rows were read from the database, which does not record the symbol each names`,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      builtAt?: string;
      unresolved?: Unresolved[];
    };
    const built = db.report()?.builtAt;
    if (built !== undefined && parsed.builtAt !== built) {
      return {
        ...fallback(),
        note: `${path} was written at ${parsed.builtAt ?? 'an unknown time'} and the database at ${built}, so the two are not from one build; rows were read from the database. Run flowatlas build.`,
      };
    }
    if (!Array.isArray(parsed.unresolved)) return fallback();
    return { rows: parsed.unresolved };
  } catch (cause) {
    return {
      ...fallback(),
      note: `${path} could not be read (${cause instanceof Error ? cause.message : String(cause)}); rows were read from the database`,
    };
  }
};

/**
 * Where the accepted numbers are, in the order they are asked for.
 *
 * A path typed on the command line is relative to where it was typed; a path in
 * the configuration is relative to the configuration, because that is the file
 * it will be read beside for the rest of its life.
 */
const baselinePathFor = (options: DoctorOptions, settings: FromConfig): string | undefined => {
  const flag = options.baseline === false ? undefined : options.baseline;
  if (flag !== undefined) return isAbsolute(flag) ? flag : resolve(process.cwd(), flag);
  if (settings.baseline !== undefined) {
    return isAbsolute(settings.baseline)
      ? settings.baseline
      : resolve(settings.rootDir ?? process.cwd(), settings.baseline);
  }
  // Beside the configuration, not under the output directory. The output
  // directory is generated and every project ignores it, so a baseline written
  // there is a decision nobody can commit — and a decision nobody committed is
  // one CI cannot read, which makes every strict run answer "no baseline".
  // This is a file a team agrees on and checks in, like a lockfile.
  return settings.rootDir === undefined ? undefined : join(settings.rootDir, BASELINE_FILE);
};

/** The numbers this run would accept, ready to be committed. */
const baselineOf = (
  db: GraphDb,
  rows: readonly Unresolved[],
  report: DoctorReport,
  settings: FromConfig,
  now: string,
  who: string,
): Baseline => ({
  baselineFormatVersion: BASELINE_FORMAT_VERSION,
  schemaVersion: db.schemaVersion(),
  flowatlasVersion: VERSION,
  acceptedAt: now,
  acceptedBy: who,
  graph: {
    builtAt: db.report()?.builtAt ?? '',
    services: Object.fromEntries(
      db.services().map((service) => [service.name, { sha: null as string | null }]),
    ),
  },
  unresolved: snapshotOf(rows, { ignoreReasons: settings.ignoreReasons }),
  markers: { warnings: report.markers.warnings },
  contracts: {
    warnings: 0,
    infos: 0,
    ignored: report.contracts.ignored,
  },
});

/**
 * Runs the check and draws it.
 *
 * The report is written before anything is printed or any exit code is decided,
 * so a failing run still leaves the artefact that explains why.
 */
export const runDoctorCommand = (options: DoctorOptions, io: QueryIo = processIo): DoctorRun => {
  const format = oneOf(options.format, FORMATS, 'text', '--format');
  // Left undefined when nobody asked, so the check can hold two defaults: a
  // section of rows is bounded at 150, and the places listed under one
  // reason at a handful. One number for both made `doctor` six hundred
  // lines on a project whose commonest reason covered seven hundred places.
  const maxNodes =
    options.maxNodes === undefined ? undefined : whole(options.maxNodes, 150, '--max-nodes');
  const sections: Section[] =
    options.section === undefined || options.section.length === 0
      ? [...SECTIONS]
      : options.section.map((name) => oneOf(name, SECTIONS, 'unresolved', '--section'));
  const accept = options.accept === true;
  const strict = options.strict === true;

  if (accept && strict) {
    throw new CliError('--accept and --strict ask opposite questions; run one at a time', EXIT.cannotRun);
  }
  if (accept && options.service !== undefined) {
    throw new CliError('--accept refuses --service: accept the whole project, or nothing', EXIT.cannotRun, [
      'A baseline over one service would be compared against every service on the next run.',
    ]);
  }

  const settings = fromConfig(options);
  const { db, close } = openProjectDb(options);
  try {
    const { rows, note } = rowsFor(db, settings.outputDir);
    const path = baselinePathFor(options, settings);

    // Reading the baseline is separate from comparing it, so that "there is no
    // baseline" can be a different answer from "the baseline says no".
    const wantsBaseline = sections.includes('baseline') && options.baseline !== false && !accept;
    let read: BaselineRead | undefined;
    if (wantsBaseline) {
      read =
        path === undefined
          ? { status: 'missing', note: 'no output directory is configured, so no baseline could be found' }
          : readBaseline(path);
    }

    const report = runDoctor(
      { db, unresolved: rows, ...(note === undefined ? {} : { note }) },
      {
        strict,
        sections,
        ...(maxNodes === undefined ? {} : { maxNodes }),
        contracts: options.contracts !== false,
        ...(read === undefined ? {} : { baseline: read }),
        baselinePath: wantsBaseline ? (path ?? null) : null,
        ignoreReasons: settings.ignoreReasons,
        warnAsError: settings.warnAsError,
        check: settings.check,
        envOwners: settings.envOwners,
        flowatlasVersion: VERSION,
        ...(options.service === undefined ? {} : { service: options.service }),
      },
    );

    const out = options.out ?? settings.outputDir;
    let file: string | undefined;
    if (out !== undefined) {
      const directory = isAbsolute(out) ? out : resolve(out);
      mkdirSync(directory, { recursive: true });
      file = join(directory, DOCTOR_FILE);
      writeFileSync(file, renderDoctorJson(report), 'utf8');
    }

    // A missing baseline is an answer on an ordinary run and a stop on a strict
    // one: a gate with nothing to compare against is not a gate, and pretending
    // otherwise is how a check quietly stops checking.
    let exitCode: number = report.verdict.exitCode;
    if (strict && report.baseline.status === 'missing') {
      exitCode = EXIT.cannotRun;
      report.verdict.exitCode = EXIT.cannotRun;
      report.verdict.reasons.push(
        `${report.baseline.note ?? 'there is no baseline'} — or pass --no-baseline to check annotations and contracts only`,
      );
      if (file !== undefined) writeFileSync(file, renderDoctorJson(report), 'utf8');
    }

    let baselineFile: string | undefined;
    if (accept) {
      if (exitCode === EXIT.cannotRun) {
        throw new CliError('refusing to accept a baseline over a run that could not complete', EXIT.cannotRun, [
          ...report.verdict.reasons,
        ]);
      }
      if (path === undefined) {
        throw new CliError('nowhere to write the baseline: no output directory is configured', EXIT.cannotRun);
      }
      writeBaseline(
        path,
        baselineOf(db, rows, report, settings, report.generatedAt, acceptedBy(settings.rootDir)),
      );
      baselineFile = path;
      exitCode = EXIT.ok;
      report.verdict.exitCode = EXIT.ok;
    }

    const text =
      format === 'json'
        ? renderDoctorJson(report)
        : format === 'github'
          ? renderDoctorGithub(report, file === undefined ? {} : { file })
          : renderDoctorText(report, {
              ...(file === undefined ? {} : { file }),
              repoDirs: settings.repoDirs,
            });

    io.out(text);
    if (baselineFile !== undefined) {
      io.err(`baseline written to ${baselineFile}: ${report.unresolved.total} places accepted\n`);
    }
    return {
      report,
      text,
      ...(file === undefined ? {} : { file }),
      ...(baselineFile === undefined ? {} : { baselineFile }),
      exitCode,
    };
  } finally {
    close();
  }
};

export { runDoctorCommand as runDoctorCli };

export const registerDoctor = (program: Command): void => {
  program
    .command('doctor')
    .description('what the map could not read, what the annotations get wrong, and what has drifted')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--format <name>', `one of ${FORMATS.join(', ')}`)
    .option('--strict', 'exit 1 on a broken annotation, a contract error, or growth past the baseline')
    .option('--accept', 'write the current numbers to the baseline')
    .option('--baseline <path>', 'where the accepted numbers live (default: <output>/baseline.json)')
    .option('--no-baseline', 'skip the growth check, so --strict asks only about annotations and contracts')
    .option(
      '--section <name>',
      `only this section: ${SECTIONS.join(', ')} (repeatable)`,
      (value: string, all: string[] = []) => [...all, value],
    )
    .option('--service <name>', 'narrow every section to one service')
    .option('--no-contracts', 'do not run the contract check')
    .option('--max-nodes <n>', 'most places to print per reason; the file is always complete')
    .option('--out <dir>', 'where to write doctor.json (default: the configured output)')
    .action((options: DoctorOptions) => {
      const { exitCode, report } = runDoctorCommand(options);
      if (exitCode !== EXIT.ok) {
        throw new CliError(summaryLine(report), exitCode as 1 | 2, report.verdict.reasons);
      }
    });
};
