/**
 * `flowatlas contracts` — every boundary in the project, compared.
 *
 * Inside one repository the compiler has already checked the types. Between two
 * repositories nobody has, and this is the command that does: it walks every
 * call, every request from a browser and every message on a channel, compares
 * what one side sends against what the other declares with the rules of the
 * JSON wire applied, and says what disagrees.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  checkContracts,
  SEVERITY_RANK,
  type CheckOptions,
  type ContractFinding,
  type ContractReport,
  type Direction,
  type Severity,
} from '@flowatlas/contracts';
import { loadConfig, type LoadedConfig } from '@flowatlas/core';
import { DEFAULT_SPEC_DEPTH, SPEC_AGAINST_FILE, type SpecAgainstReport } from '@flowatlas/linker';
import type { Command } from 'commander';
import { openProjectDb, type ReadOptions } from '../analysis/open.js';
import { cannotRun, CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { renderSpecAgainstText, specAgainstLines } from '../report/spec.js';
import { againstFailures, againstReport, configuredCommitted, withChanges } from './spec-against.js';
import {
  renderContractsJson,
  renderContractsMarkdown,
  renderContractsText,
} from '../render/contracts.js';
import {
  contractFindings,
  deliverSarif,
  specFindings,
  sarifBound,
  sarifLevelFlag,
  sarifPathsOf,
  toSarif,
  withSarifOptions,
  type SarifFlags,
  type SarifLevel,
} from '../sarif/index.js';
import { VERSION } from '../version.js';

export const FORMATS = ['text', 'json', 'markdown', 'sarif'] as const;
export type ContractsFormat = (typeof FORMATS)[number];

export const FAIL_LEVELS = ['none', 'error', 'warning'] as const;
export type FailLevel = (typeof FAIL_LEVELS)[number];

/** The file every run leaves behind, whatever it printed. */
export const CONTRACTS_FILE = 'contracts.json';

export interface ContractsOptions extends ReadOptions, SarifFlags {
  severity?: string;
  failOn?: string;
  edge?: string;
  service?: string;
  direction?: string;
  depth?: string;
  /** `false` only when `--no-ignore` was passed; commander defaults it to true. */
  ignore?: boolean;
  maxNodes?: string;
  /** Where to write `contracts.json`. Defaults to the configured output. */
  out?: string;
}

export interface ContractsRun {
  report: ContractReport;
  /** The report as the flags narrowed it, which is what was printed. */
  shown: ContractReport;
  text: string;
  /** Where the complete report was written, or undefined when nowhere was known. */
  file?: string;
  /** Every document a service's configuration lists under `apiDocuments`, against its code (P195). */
  documents?: SpecAgainstReport;
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

/** What the project asked for in `flowatlas.config.json`, when there is one. */
interface FromConfig {
  /** The configuration, for what is read beside the graph: the committed API documents. */
  loaded?: LoadedConfig;
  outputDir?: string;
  depth?: number;
  disableRules?: string[];
  ignoreEdges?: string[];
}

const fromConfig = (options: ContractsOptions): FromConfig => {
  try {
    const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
    const contracts = loaded.config.contracts;
    return {
      loaded,
      outputDir: loaded.outputDir,
      ...(contracts.depth === undefined ? {} : { depth: contracts.depth }),
      disableRules: [...contracts.rules.disable],
      ignoreEdges: [...contracts.ignoreEdges],
    };
  } catch {
    // Pointed at a bare database with no configuration beside it there is
    // nothing to read, and answering the question is better than refusing to.
    return options.db === undefined ? {} : { outputDir: dirname(resolve(options.db)) };
  }
};

const matches = (finding: { sender: { service: string }; receiver: { service: string } }, service: string): boolean =>
  finding.sender.service === service || finding.receiver.service === service;

/**
 * The report as the flags narrowed it.
 *
 * The file on disk is always the whole thing: narrowing is a question a person
 * asked once, and a later reader of the file has no way to know it was asked.
 */
const narrow = (
  report: ContractReport,
  filters: { edge?: string; service?: string; direction?: Direction },
): ContractReport => {
  if (filters.edge === undefined && filters.service === undefined && filters.direction === undefined) {
    return report;
  }
  const keep = (row: { edgeKey: string; direction: Direction }): boolean =>
    (filters.edge === undefined || row.edgeKey === filters.edge) &&
    (filters.direction === undefined || row.direction === filters.direction);
  const keepFinding = (finding: ContractFinding): boolean =>
    keep(finding) && (filters.service === undefined || matches(finding, filters.service));

  const edges = report.edges.filter(
    (edge) => keep(edge) && (filters.service === undefined || matches(edge, filters.service)),
  );
  const findings = report.findings.filter(keepFinding);
  const ignored = report.ignored.filter(keepFinding);
  const unchecked = report.unchecked.filter(keep);
  const count = (status: string): number => edges.filter((edge) => edge.status === status).length;
  const level = (severity: Severity): number =>
    findings.filter((finding) => finding.severity === severity).length;

  return {
    ...report,
    edges,
    findings,
    ignored,
    unchecked,
    summary: {
      edges: edges.length,
      shared: count('shared'),
      identical: count('identical'),
      hash_differs: count('hash_differs'),
      unchecked: unchecked.length,
      errors: level('error'),
      warnings: level('warning'),
      infos: level('info'),
      ignored: ignored.length,
    },
  };
};

/** `--severity` as the least SARIF level written. */
const SEVERITY_LEVEL: Readonly<Record<Severity, SarifLevel>> = { error: 'error', warning: 'warning', info: 'note' };

/** Whether anything found is at or above the level that fails the command. */
const fails = (report: ContractReport, failOn: FailLevel): boolean =>
  failOn !== 'none' &&
  report.findings.some((finding) => SEVERITY_RANK[finding.severity] <= SEVERITY_RANK[failOn]);

/**
 * Runs the check and draws it.
 *
 * The complete report is written to disk before anything is printed or any exit
 * code is decided, so a failing run still leaves the artefact that explains why.
 */
export const runContracts = (options: ContractsOptions, io: QueryIo = processIo): ContractsRun => {
  const format = oneOf(options.format, FORMATS, 'text', '--format');
  const severity = oneOf(options.severity, ['error', 'warning', 'info'] as const, 'info', '--severity');
  const failOn = oneOf(options.failOn, FAIL_LEVELS, 'none', '--fail-on');
  const direction = options.direction === undefined
    ? undefined
    : oneOf(options.direction, ['request', 'response', 'payload'] as const, 'request', '--direction');
  const maxNodes = whole(options.maxNodes, 150, '--max-nodes');
  const sarifLevel = sarifLevelFlag(options.sarifLevel);

  const settings = fromConfig(options);
  const { db, close } = openProjectDb(options);
  try {
    const check: CheckOptions = {
      depth: whole(options.depth, settings.depth ?? 3, '--depth'),
      ...(settings.disableRules === undefined ? {} : { disableRules: settings.disableRules }),
      ...(settings.ignoreEdges === undefined ? {} : { ignoreEdges: settings.ignoreEdges }),
      ...(options.ignore === false ? { honourIgnore: false } : {}),
    };
    // A graph with no types in it cannot answer this question at all, and a
    // build that was told not to collect them looks exactly like a project with
    // no shapes. Saying which one it is beats answering "nothing is broken".
    if (db.counts().types === 0) {
      throw cannotRun('0 types in the registry, so there is nothing to compare', [
        'Rebuild without --no-types.',
      ]);
    }
    const report = checkContracts(db, check);

    // The documents services commit by hand, against their code (P195): the
    // comparison `spec --against` makes, for every one the configuration lists.
    const committed = settings.loaded === undefined ? [] : configuredCommitted(settings.loaded);
    const documents = settings.loaded === undefined || committed.length === 0 ? undefined : againstReport(settings.loaded, db, committed, DEFAULT_SPEC_DEPTH);

    const out = options.out ?? settings.outputDir;
    let file: string | undefined;
    let documentsFile: string | undefined;
    if (out !== undefined) {
      const directory = isAbsolute(out) ? out : resolve(out);
      mkdirSync(directory, { recursive: true });
      file = join(directory, CONTRACTS_FILE);
      writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      if (documents !== undefined) {
        documentsFile = join(directory, SPEC_AGAINST_FILE);
        writeFileSync(documentsFile, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
      }
    }

    const view = narrow(report, {
      ...(options.edge === undefined ? {} : { edge: options.edge }),
      ...(options.service === undefined ? {} : { service: options.service }),
      ...(direction === undefined ? {} : { direction }),
    });
    // `--service` narrows the documents too; `--edge` and `--direction` name boundaries, which a document is not.
    const documentsShown = documents === undefined ? undefined : options.service === undefined ? documents : withChanges(documents, documents.changes.filter((change) => change.service === options.service));
    const drawn = { severity, maxNodes, ...(file === undefined ? {} : { file }) };
    const documentsDrawn = { maxRows: maxNodes, ...(documentsFile === undefined ? {} : { file: documentsFile }) };
    let text: string;
    if (format === 'sarif') {
      // Every finding of the view and every one excused, the sender's line
      // first (P115); `--severity` is the least level written unless
      // `--sarif-level` says otherwise.
      const log = toSarif({
        command: 'contracts',
        version: VERSION,
        findings: [...contractFindings(view, { lookup: db }), ...specFindings(documentsShown?.changes ?? [])],
        paths: sarifPathsOf(options, options.sarifRoot),
        maxResults: sarifBound(options.maxNodes === undefined ? undefined : maxNodes),
        minLevel: sarifLevel ?? SEVERITY_LEVEL[severity],
        ...(file === undefined ? {} : { completeFile: file }),
      });
      text = deliverSarif(log, options, io);
    } else {
      // The JSON is contracts.json's format and stays it; the documents' answer is spec-against.json.
      text =
        format === 'json'
          ? renderContractsJson(view, drawn)
          : format === 'markdown'
            ? `${renderContractsMarkdown(view, drawn)}${documentsShown === undefined ? '' : `\n${specAgainstLines(documentsShown, documentsDrawn).join('\n')}\n`}`
            : `${renderContractsText(view, drawn)}${documentsShown === undefined ? '' : `\n${renderSpecAgainstText(documentsShown, documentsDrawn)}`}`;
      io.out(text);
    }
    const documentsFail = documentsShown !== undefined && failOn !== 'none' && againstFailures(documentsShown, failOn).length > 0;
    return {
      report,
      shown: view,
      text,
      ...(file === undefined ? {} : { file }),
      ...(documents === undefined ? {} : { documents }),
      exitCode: fails(view, failOn) || documentsFail ? EXIT.failed : EXIT.ok,
    };
  } finally {
    close();
  }
};

export const registerContracts = (program: Command): void => {
  const command = program
    .command('contracts')
    .description('compare what each service sends against what the other declares')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--format <name>', `one of ${FORMATS.join(', ')}`)
    .option('--severity <level>', 'least severe finding to show: error, warning or info')
    .option('--fail-on <level>', `exit 1 on a finding at this level or worse: ${FAIL_LEVELS.join(', ')}`)
    .option('--edge <key>', 'only this edge, as `from|type|to`')
    .option('--service <name>', 'only boundaries this service is on either side of')
    .option('--direction <name>', 'only request, response or payload')
    .option('--depth <n>', 'how far into nested shapes to compare')
    .option('--max-nodes <n>', 'most findings to print; the file is always complete')
    .option('--out <dir>', 'where to write contracts.json (default: the configured output)')
    .option('--no-ignore', 'report the findings @ContractIgnore excuses as ordinary ones');
  withSarifOptions(command).action((options: ContractsOptions) => {
      const { exitCode, documents } = runContracts(options);
      if (exitCode !== EXIT.ok) {
        throw new CliError(
          documents === undefined ? 'contract findings at or above --fail-on' : 'contract findings, or promises a committed document makes that the code does not keep, at or above --fail-on',
          EXIT.failed,
        );
      }
    });
};
