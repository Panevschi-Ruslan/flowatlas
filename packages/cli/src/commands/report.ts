import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { handleFor, type DbOptions } from '../db.js';
import { graphFaults, waysOf } from '../doctor/run.js';
import { cannotRun } from '../exit.js';
import { DEFAULT_OVERVIEW_TOP, OVERVIEW_SECTIONS, overviewFingerprint, overviewOf, type Overview, type OverviewSection } from '../overview/overview.js';
import { renderOverview } from '../overview/render.js';
import { processIo, type QueryIo } from '../query/answer.js';

/** What `report` writes when `--output` is a directory (P228, decided by the maintainer). */
export const REPORT_FILE = 'ARCHITECTURE.md';

export const REPORT_FORMATS = ['markdown', 'json'] as const;

export interface ReportOptions extends DbOptions {
  output?: string;
  sections?: string;
  format?: string;
  top?: string;
  service?: string;
}

export interface ReportRun {
  overview: Overview;
  fingerprint: string;
  text: string;
  /** Where it was written, when `--output` was given. */
  path?: string;
}

/** `--sections a,b`, checked: every section unless asked. */
export const sectionsOf = (value: string | undefined): OverviewSection[] | undefined => {
  if (value === undefined) return undefined;
  const asked = value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  const wrong = asked.filter((item) => !(OVERVIEW_SECTIONS as readonly string[]).includes(item));
  if (wrong.length > 0 || asked.length === 0) throw cannotRun(`--sections takes ${OVERVIEW_SECTIONS.join(', ')}, not ${JSON.stringify(value)}`);
  return asked as OverviewSection[];
};

/**
 * The page a person reads first (P228): what the project is and what crosses
 * between its services, what most of it depends on, what is worth a second
 * look, what was not read, and the questions to ask next. Printed, or written
 * with `--output`. A graph `doctor` would refuse - a failed build, an empty
 * graph, a service that gave nothing - is refused here too (exit 2): a page
 * about it would describe the reading, not the project.
 */
export const runReport = (options: ReportOptions, io: QueryIo = processIo): ReportRun => {
  const format = options.format ?? 'markdown';
  if (!(REPORT_FORMATS as readonly string[]).includes(format)) throw cannotRun(`--format must be one of ${REPORT_FORMATS.join(', ')}, not ${JSON.stringify(format)}`);
  const sections = sectionsOf(options.sections);
  const topN = options.top === undefined ? DEFAULT_OVERVIEW_TOP : Number(options.top);
  if (!Number.isInteger(topN) || topN < 1) throw cannotRun(`--top must be a whole number of at least 1, not ${JSON.stringify(options.top)}`);
  const handle = handleFor(options);
  const opened = handle.open();
  if ('error' in opened) throw cannotRun(opened.error);
  const db = opened.db;
  try {
    const faults = graphFaults(db, waysOf(db, options.service), options.service);
    if (faults.length > 0) throw cannotRun('this graph is not one to report on', [...faults, 'flowatlas doctor says why']);
    const overview = overviewOf(db, handle, { top: topN, ...(options.service === undefined ? {} : { service: options.service }) });
    const fingerprint = overviewFingerprint(overview);
    const text =
      format === 'json'
        ? `${JSON.stringify({ overviewFormatVersion: 1, fingerprint, ...overview }, null, 2)}\n`
        : renderOverview(overview, sections === undefined ? {} : { sections });
    if (options.output === undefined) {
      io.out(text);
      return { overview, fingerprint, text };
    }
    const asked = resolve(options.output);
    const path = existsSync(asked) && statSync(asked).isDirectory() ? join(asked, REPORT_FILE) : asked;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    io.err(`wrote ${path}\n`);
    return { overview, fingerprint, text, path };
  } finally {
    db.close();
  }
};

export const registerReport = (program: Command): void => {
  program
    .command('report')
    .description('the page a person reads first: what crosses between the services, what most depends on, what was not read')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--output <file>', `write it there; a directory gets ${REPORT_FILE}`)
    .option('--sections <names>', `only these: ${OVERVIEW_SECTIONS.join(', ')}`)
    .option('--format <name>', `one of ${REPORT_FORMATS.join(', ')}`)
    .option('--top <n>', `most rows of each list (default ${DEFAULT_OVERVIEW_TOP})`)
    .option('--service <name>', 'only what touches this service')
    .action((options: ReportOptions) => {
      runReport(options);
    });
};
