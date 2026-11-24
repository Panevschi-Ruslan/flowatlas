/**
 * `flowatlas findings` (P384): what looks broken between the services first,
 * then the rest of what the reading found about the code, ranked - the graph
 * server's `findings` answer, from the same function, so the command line, the
 * tool and a SARIF upload rank alike.
 *
 * Every row carries its precision; `--fail-on high` exits 1 when a finding at
 * that precision or surer is listed, so a pipeline can stop on the defects the
 * graph is nearly always right about and leave the rest to a reader.
 */
import { FlowatlasError, PRECISION_NAMES, type Precision } from '@flowatlas/core';
import { compareFindingKinds, type FindingRow } from '@flowatlas/linker';
import { DbHandle, findingsOf, type DbHandleOptions } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { CliError, EXIT } from '../exit.js';
import { print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { processIo } from '../query/answer.js';
import { deliverSarif, findingResults, sarifBound, sarifLevelFlag, sarifPathsOf, toSarif, withSarifOptions, type SarifFlags, type SarifLog } from '../sarif/index.js';
import { VERSION } from '../version.js';

export interface FindingsCommandOptions extends ReadOptions, SarifFlags {
  kind?: string;
  service?: string;
  /** Exit 1 when a finding at this precision or surer is listed. */
  failOn?: string;
}

export interface FindingsRun {
  rows: FindingRow[];
  heldBack: Record<string, { count: number; why: string }>;
  lines: string[];
  /** The rows at or above `--fail-on`. */
  failing: number;
  sarif?: SarifLog;
}

const SURENESS: Readonly<Record<Precision, number>> = { high: 0, medium: 1, low: 2 };

/** `--fail-on`, checked. */
const failOnOf = (value: string | undefined): Precision | undefined => {
  if (value === undefined) return undefined;
  const found = PRECISION_NAMES.find((name) => name === value);
  if (found === undefined) throw new FlowatlasError('bad-argument', `--fail-on must be one of ${PRECISION_NAMES.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

/** One row as a line: how sure, what, where, and the nearest fix under it. */
const rowLines = (row: FindingRow): string[] => [
  `  ${row.rank}. [${row.precision}] ${row.message}${row.loc === undefined ? '' : ` (${row.service === '' ? '' : `${row.service} `}${row.loc})`}`,
  ...(row.fix === undefined ? [] : [`     ${row.fix}`]),
  ...(row.seenBy === undefined ? [] : [`     met through ${row.seenBy.join(', ')}`]),
];

export const runFindings = (options: FindingsCommandOptions): FindingsRun => {
  const failOn = failOnOf(options.failOn);
  const sarifLevel = sarifLevelFlag(options.sarifLevel);
  const settings: DbHandleOptions = {};
  if (options.db !== undefined) settings.dbPath = options.db;
  if (options.config !== undefined) settings.configPath = options.config;
  else if (options.db === undefined) settings.configPath = process.cwd();
  const handle = new DbHandle(settings);
  const opened = handle.open();
  if ('error' in opened) throw new FlowatlasError('no-graph', opened.error, 'Run flowatlas build, then ask again.');
  try {
    const found = findingsOf(opened.db, { handle }, options.service);
    const rows = options.kind === undefined ? found.ranked : found.ranked.filter((row) => row.kind === options.kind);
    const kinds = [...new Set(rows.map((row) => row.kind))].sort(compareFindingKinds);
    const lines: string[] = [];
    for (const kind of kinds) {
      const ofKind = rows.filter((row) => row.kind === kind);
      lines.push(`${kind} (${ofKind.length})`, ...ofKind.flatMap(rowLines), '');
    }
    if (rows.length === 0) lines.push(options.kind === undefined ? 'no findings' : `no ${options.kind} findings`, '');
    for (const [kind, held] of Object.entries(found.heldBack)) {
      if (options.kind !== undefined && kind !== options.kind) continue;
      lines.push(`held back: ${held.count} ${kind}, the evidence not holding (${held.why})`);
    }
    const failing = failOn === undefined ? 0 : rows.filter((row) => SURENESS[row.precision] <= SURENESS[failOn]).length;
    const sarif =
      options.format === 'sarif'
        ? toSarif({
            command: 'findings',
            version: VERSION,
            findings: findingResults(rows),
            paths: sarifPathsOf(options, options.sarifRoot),
            maxResults: sarifBound(undefined),
            ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
          })
        : undefined;
    return { rows, heldBack: found.heldBack, lines, failing, ...(sarif === undefined ? {} : { sarif }) };
  } finally {
    handle.close();
  }
};

export const registerFindings = (program: Command): void => {
  const command = program
    .command('findings')
    .description('what looks broken between the services first, then the rest of what the reading found, ranked, each with its precision')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--kind <kind>', 'only this kind: call-to-missing-route, field-never-sent, type-never-published, contract-break, unguarded-among-guarded, ...')
    .option('--service <name>', 'only this service')
    .option('--fail-on <precision>', `exit 1 when a finding at this precision or surer is listed: ${PRECISION_NAMES.join(', ')}`)
    .option('--format <kind>', 'json, table or sarif (default: table)');
  withSarifOptions(command).action((options: FindingsCommandOptions) => {
    const run = runFindings(options);
    if (run.sarif !== undefined) deliverSarif(run.sarif, options, processIo);
    else print({ findings: run.rows, heldBack: run.heldBack }, run.lines, wantsJson(options));
    if (run.failing > 0) throw new CliError(`${run.failing} finding${run.failing === 1 ? '' : 's'} at or above --fail-on ${options.failOn ?? ''}`, EXIT.failed);
  });
};
