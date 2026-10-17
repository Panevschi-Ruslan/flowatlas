/**
 * `flowatlas spec --against <service>=<file>` — does a committed API document
 * still describe the code (P195)?
 *
 * The document is read through its format's reader and written back in the
 * code's normal form, the code's document is written from the graph, and the
 * two are compared kind by kind (`specAgainst`): a route or channel end the
 * document declares and the code does not answer is an error at the
 * document's line; one the code answers and the document leaves out is said
 * too. Nothing is ever written into a repository (P78): the report goes to
 * `spec-against.json` under the output directory.
 *
 * `contracts` runs the same comparison for every document a service's
 * configuration lists under `apiDocuments`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DocumentSyntaxError, loadConfig, readDocument, type LoadedConfig, type ServiceConfig } from '@flowatlas/core';
import type { GraphLookup } from '@flowatlas/contracts';
import {
  DEFAULT_SPEC_DEPTH,
  DOCUMENT_KINDS,
  DocumentError,
  parseSpecAgainst,
  SPEC_AGAINST_FILE,
  SPEC_CHANGE_KINDS,
  SPEC_FAIL_LEVELS,
  specAgainst,
  specOptionsOf,
  writeSpecs,
  type CommittedDocument,
  type SpecAgainstReport,
  type SpecChange,
  type SpecFailLevel,
  type SpecKind,
} from '@flowatlas/linker';
import { openProjectDb } from '../analysis/open.js';
import { cannotRun, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { renderSpecAgainstMarkdown, renderSpecAgainstText, summariseSpecDiff } from '../report/spec.js';
import { deliverSarif, sarifBound, sarifLevelFlag, sarifPathsOf, specFindings, toSarif } from '../sarif/index.js';
import { VERSION } from '../version.js';
import { oneOf, whole } from './diff.js';

export const SPEC_AGAINST_FORMATS = ['text', 'markdown', 'json', 'sarif'] as const;

export interface SpecAgainstOptions {
  config?: string;
  db?: string;
  /** `<service>[@<application>]=<file>`, or `<service>` for the documents its configuration lists. */
  against?: string[];
  format?: string;
  failOn?: string;
  output?: string;
  sarifRoot?: string;
  sarifLevel?: string;
  maxRows?: string;
  depth?: string;
  /** Where `spec-against.json` goes. Defaults to the configured output. */
  out?: string;
}

export interface SpecAgainstRun {
  report: SpecAgainstReport;
  text: string;
  file: string;
  exitCode: number;
}

/** The kind a document is by what it says it is, when nobody said. */
const kindOf = (raw: unknown, shown: string): SpecKind => {
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof record['openapi'] === 'string') return 'openapi';
  if (typeof record['asyncapi'] === 'string') return 'asyncapi';
  throw cannotRun(`${shown} says neither openapi nor asyncapi at its top, so it is not a document this compares`, [
    `The kinds compared: ${DOCUMENT_KINDS.join(', ')}.`,
  ]);
};

const KINDS: readonly SpecKind[] = ['openapi', 'asyncapi'];

/**
 * One committed document, read with where each of its values is written.
 * Placed inside the service's repository when it is there, so a change lands
 * on the file a code-scanning upload shows.
 */
export const readCommitted = (
  loaded: LoadedConfig,
  service: ServiceConfig,
  path: string,
  given: { kind?: string; application?: string } = {},
): CommittedDocument => {
  const absolute = isAbsolute(path) ? path : resolve(loaded.rootDir, path);
  const shown = relative(loaded.rootDir, absolute).replace(/\\/g, '/') || path;
  if (!existsSync(absolute)) throw cannotRun(`no document at ${shown} to compare ${service.name} with`);
  const text = readFileSync(absolute, 'utf8');
  const format = extname(absolute).toLowerCase() === '.json' || /^\s*[{[]/.test(text) ? 'json' : 'yaml';
  let read;
  try {
    read = readDocument(text, format);
  } catch (error) {
    if (!(error instanceof DocumentSyntaxError)) throw error;
    throw cannotRun(`${shown}:${error.position.line} is not ${format === 'json' ? 'JSON' : 'YAML'}: ${error.message}`);
  }
  const kind = given.kind ?? kindOf(read.value, shown);
  if (!KINDS.includes(kind as SpecKind)) throw cannotRun(`${kind} is not a kind of document this compares; write one of ${KINDS.join(', ')}`);
  const repo = loaded.repoDir(service);
  const inside = absolute.startsWith(`${repo}${sep}`);
  const positioned = read;
  return {
    kind: kind as SpecKind,
    service: service.name,
    ...(given.application === undefined ? {} : { application: given.application }),
    file: (inside ? relative(repo, absolute) : shown).replace(/\\/g, '/'),
    raw: read.value,
    lineAt: (steps) => positioned.at(steps)?.line,
  };
};

/** The service a name names, refused by name with the known ones; a declared one has no code to compare. */
const serviceNamed = (loaded: LoadedConfig, name: string): ServiceConfig => {
  const service = loaded.config.services.find((entry) => entry.name === name);
  if (service === undefined) {
    throw cannotRun(`no service named ${JSON.stringify(name)}`, [`Known services: ${loaded.config.services.map((entry) => entry.name).sort().join(', ')}.`]);
  }
  if (service.document !== undefined) throw cannotRun(`${name} is declared by its document, so there is no code to compare a document with`);
  return service;
};

/** Every document a configuration lists under `apiDocuments`, read; the services with none are left out. */
export const configuredCommitted = (loaded: LoadedConfig, only?: { service: string; application?: string }): CommittedDocument[] =>
  loaded.config.services.flatMap((service) =>
    service.document !== undefined || (only !== undefined && service.name !== only.service)
      ? []
      : (service.apiDocuments ?? [])
          .filter((entry) => only?.application === undefined || entry.application === only.application)
          .map((entry) =>
            readCommitted(loaded, service, entry.path, { kind: entry.kind, ...(entry.application === undefined ? {} : { application: entry.application }) }),
          ),
  );

/** `orders=docs/openapi.yaml`, `orders@admin=admin.yaml`, or `orders` for what its configuration lists. */
const committedOf = (loaded: LoadedConfig, said: string): CommittedDocument[] => {
  const at = said.indexOf('=');
  const who = at === -1 ? said : said.slice(0, at);
  const [name = '', application] = who.split('@');
  const service = serviceNamed(loaded, name);
  if (at === -1) {
    const listed = configuredCommitted(loaded, { service: name, ...(application === undefined ? {} : { application }) });
    if (listed.length === 0) throw cannotRun(`${who} lists no apiDocuments, so --against ${said} names nothing`, ['Name the file: --against <service>=<file>.']);
    return listed;
  }
  const file = said.slice(at + 1);
  if (file === '') throw cannotRun(`--against ${said} names no file`);
  return [readCommitted(loaded, service, file, application === undefined ? {} : { application })];
};

/** The documents compared and the code's documents of their services, compared. */
export const againstReport = (
  loaded: LoadedConfig,
  lookup: GraphLookup,
  committed: readonly CommittedDocument[],
  depth: number,
): SpecAgainstReport => {
  const writerOptions = specOptionsOf(loaded.config, { depth });
  const services = [...new Set(committed.map((document) => document.service))];
  try {
    const report = specAgainst(committed, writeSpecs(lookup, services, writerOptions), { ...writerOptions, depth });
    return parseSpecAgainst(report);
  } catch (error) {
    if (error instanceof DocumentError) throw cannotRun(error.message);
    throw error;
  }
};

/** The report with only some of its changes, counted again: what `contracts --service` shows. */
export const withChanges = (report: SpecAgainstReport, changes: readonly SpecChange[]): SpecAgainstReport => {
  const level = (wanted: string): number => changes.filter((change) => change.level === wanted).length;
  return {
    ...report,
    changes: [...changes],
    summary: {
      errors: level('error'),
      warnings: level('warning'),
      infos: level('info'),
      breaking: changes.filter((change) => SPEC_CHANGE_KINDS[change.kind].level === 'error').length,
      uncalled: changes.filter((change) => change.note !== null).length,
    },
  };
};

/** The changes at or above the level `--fail-on` names. */
export const againstFailures = (report: SpecAgainstReport, failOn: SpecFailLevel): SpecChange[] =>
  failOn === 'none' ? [] : report.changes.filter((change) => change.level === 'error' || (failOn === 'warning' && change.level === 'warning'));

/**
 * Compares each document named with the code, writes `spec-against.json`,
 * and draws the answer. Exit 1 on a promise the code does not keep (an
 * error; with `--fail-on warning`, a warning too), 2 on a document that
 * cannot be read.
 */
export const runSpecAgainst = (options: SpecAgainstOptions, io: QueryIo = processIo): SpecAgainstRun => {
  const format = oneOf(options.format, SPEC_AGAINST_FORMATS, 'text', '--format');
  const failOn = oneOf(options.failOn, SPEC_FAIL_LEVELS, 'error', '--fail-on') as SpecFailLevel;
  const maxRows = whole(options.maxRows, 50, '--max-rows');
  const depth = whole(options.depth, DEFAULT_SPEC_DEPTH, '--depth');
  const sarifLevel = sarifLevelFlag(options.sarifLevel);
  const loaded = loadConfig(options.config ?? process.cwd());
  const committed = (options.against ?? []).flatMap((said) => committedOf(loaded, said));
  if (committed.length === 0) throw cannotRun('--against names no document: --against <service>=<file>');

  const { db, close } = openProjectDb({ ...(options.config === undefined ? {} : { config: options.config }), ...(options.db === undefined ? {} : { db: options.db }) });
  let report: SpecAgainstReport;
  try {
    report = againstReport(loaded, db, committed, depth);
  } finally {
    close();
  }

  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  mkdirSync(outputDir, { recursive: true });
  const file = join(outputDir, SPEC_AGAINST_FILE);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  let text: string;
  if (format === 'sarif') {
    text = deliverSarif(
      toSarif({
        command: 'spec-against',
        version: VERSION,
        findings: specFindings(report.changes),
        paths: sarifPathsOf({ config: loaded.configPath }, options.sarifRoot),
        maxResults: sarifBound(undefined),
        ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
        completeFile: file,
      }),
      options.output === undefined ? {} : { output: options.output },
      io,
    );
  } else {
    text =
      format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : format === 'markdown'
          ? renderSpecAgainstMarkdown(report, { maxRows, file })
          : renderSpecAgainstText(report, { maxRows, file });
    io.out(text);
    if (options.output !== undefined) writeFileSync(isAbsolute(options.output) ? options.output : resolve(options.output), text, 'utf8');
  }
  io.err(`spec --against: ${summariseSpecDiff(report)} · ${file}\n`);
  return { report, text, file, exitCode: againstFailures(report, failOn).length > 0 ? EXIT.failed : EXIT.ok };
};
